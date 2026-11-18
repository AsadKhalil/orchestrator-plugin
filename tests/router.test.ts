import { test } from 'node:test';
import assert from 'node:assert/strict';
import { route, candidates, described, linesFor, checksStatus, modeLabel, reviewRules, REVIEW_RULES_KEY, UNSURE_BELOW, LINE_UNSURE_BELOW, MAX_LINES, brief, safeHead, type LineAnswer } from '../src/router.js';
import type { Mode } from '../src/relay-store.js';

const m = (id: string, input = ['text'], extra = {}) => ({ providerID: 'p', id, enabled: true, status: 'active', variants: ['high'], capabilities: { input }, limit: { context: 1000 }, ...extra });
const models = [m('plan'), m('exec'), m('review'), m('deep'), m('eyes', ['text', 'image']), m('big', ['text'], { limit: { context: 100000 } })];
const pick = (id: string, variant: string | null = null) => ({ providerID: 'p', id, variant });
const entry = (id: string, useFor = '', variant: string | null = null) => ({ ...pick(id, variant), useFor });
const settings = { modes: { plan: [entry('plan')], execute: [entry('exec', '', 'high')], review: [entry('review')] } };
const withPlan = (...plan: ReturnType<typeof entry>[]) => ({ modes: { ...settings.modes, plan } });
const three = withPlan(entry('plan', 'short questions'), entry('deep', 'hard design'), entry('eyes', 'screens and layout'));
const nothing = { needsImage: false, tokens: 0 };
const sure = (mode: Mode, confidence = 0.9, lines: Partial<Record<Mode, LineAnswer>> = {}) => ({ kind: 'answer', mode, confidence, lines, ms: 5, costUsd: null }) as const;

test('each mode gets its agent, and a mode with one model gets that model', () => {
  assert.deepEqual(route(sure('execute'), settings, models, nothing, null), { switch: true, mode: 'execute', agent: 'build', model: pick('exec', 'high'), fit: null, note: null });
  assert.deepEqual(route(sure('plan'), settings, models, nothing, null), { switch: true, mode: 'plan', agent: 'plan', model: pick('plan'), fit: null, note: null });
  assert.deepEqual(route(sure('review'), settings, models, nothing, null), { switch: true, mode: 'review', agent: 'plan', model: pick('review'), fit: null, note: null });
  assert.deepEqual([modeLabel('plan'), modeLabel('execute'), modeLabel('review')], ['Plan', 'Execute', 'Review']);
});

test('with the switch on, an unsure answer leaves the chat as it is', () => {
  assert.deepEqual(route(sure('execute', 0.59), settings, models, nothing, null, 'stay'), { switch: false, mode: null, note: 'not sure, so the chat stays as it is' });
  assert.equal((route(sure('execute', 0.6), settings, models, nothing, null, 'stay') as { agent: string }).agent, 'build', '0.6 itself is sure');
  assert.deepEqual(route(sure('execute', 0.59), settings, models, nothing, null, 'plan'), route(sure('execute', 0.59), settings, models, nothing, null), '/relay keeps its own rule');
});

test('confidence below 0.6 gives Plan, and 0.6 itself does not', () => {
  assert.equal(UNSURE_BELOW, 0.6);
  assert.deepEqual(route(sure('execute', 0.59), settings, models, nothing, null), { switch: true, mode: 'plan', agent: 'plan', model: pick('plan'), fit: null, note: 'not sure, so Plan' });
  assert.equal((route(sure('execute', 0.6), settings, models, nothing, null) as { agent: string }).agent, 'build');
});

test('no answer gives no switch, with the reason', () => {
  assert.deepEqual(route({ kind: 'none', reason: 'no decider chosen', ms: 0 }, settings, models, nothing, null), { switch: false, mode: null, note: 'no decider chosen' });
});

test('with no lines written, the first usable model in the list wins', () => {
  const list = [entry('gone'), entry('off'), entry('old'), entry('exec', '', 'ultra'), entry('exec', '', 'high'), entry('deep')];
  const offeredNow = [...models, m('off', ['text'], { enabled: false }), m('old', ['text'], { status: 'deprecated' })];
  assert.deepEqual(route(sure('execute'), { modes: { ...settings.modes, execute: list } }, offeredNow, nothing, pick('other')), { switch: true, mode: 'execute', agent: 'build', model: pick('exec', 'high'), fit: null, note: null });
});

test('a picture needs a model that takes pictures', () => {
  const picture = { needsImage: true, tokens: 0 };
  assert.deepEqual(route(sure('execute'), settings, models, picture, null), { switch: false, mode: 'execute', note: 'no chosen Execute model takes pictures' });
  const both = { modes: { ...settings.modes, execute: [entry('exec', '', 'high'), entry('eyes')] } };
  assert.deepEqual((route(sure('execute'), both, models, picture, null) as { model: unknown }).model, pick('eyes'));
});

test('attached files must fit the model, and a model with no known size is kept', () => {
  const files = { needsImage: false, tokens: 1001 };
  assert.deepEqual(route(sure('execute'), settings, models, files, null), { switch: false, mode: 'execute', note: 'the attached files are too big for every chosen Execute model' });
  assert.equal((route(sure('execute'), settings, models, { needsImage: false, tokens: 1000 }, null) as { switch: boolean }).switch, true, 'exactly full still fits');
  const both = { modes: { ...settings.modes, execute: [entry('exec', '', 'high'), entry('big')] } };
  assert.deepEqual((route(sure('execute'), both, models, files, null) as { model: unknown }).model, pick('big'));
  const unknown = [m('exec', ['text'], { limit: { context: 0 } })];
  assert.deepEqual((route(sure('execute'), settings, unknown, files, null) as { model: unknown }).model, pick('exec', 'high'));
});

test('an empty list, or a list with nothing on offer, gives no switch', () => {
  assert.deepEqual(route(sure('review'), { modes: { ...settings.modes, review: [] } }, models, nothing, null), { switch: false, mode: 'review', note: 'no model chosen for Review' });
  assert.deepEqual(route(sure('review'), { modes: { ...settings.modes, review: [entry('gone')] } }, models, nothing, null), { switch: false, mode: 'review', note: 'no chosen Review model is offered right now' });
  assert.deepEqual(route(sure('execute', 0.2), withPlan(), models, nothing, null), { switch: false, mode: 'plan', note: 'not sure, so Plan; no model chosen for Plan' });
});

test('the line the decider chose picks the model, from a confidence of 0.5', () => {
  assert.equal(LINE_UNSURE_BELOW, 0.5);
  assert.deepEqual(route(sure('plan', 0.9, { plan: { index: 1, confidence: 0.8 } }), three, models, nothing, pick('plan')), { switch: true, mode: 'plan', agent: 'plan', model: pick('deep'), fit: 0.8, note: null });
  assert.deepEqual(route(sure('plan', 0.9, { plan: { index: 2, confidence: 0.5 } }), three, models, nothing, null), { switch: true, mode: 'plan', agent: 'plan', model: pick('eyes'), fit: 0.5, note: null });
  assert.deepEqual((route(sure('plan', 0.9, { plan: { index: 2, confidence: 0.49 } }), three, models, nothing, null) as { model: unknown }).model, pick('plan'));
});

test('when no line fits, the chat keeps its model if the mode can use it, and else the first is used', () => {
  const noLine = sure('plan', 0.9, { plan: { index: null, confidence: 0.95 } });
  assert.deepEqual(route(noLine, three, models, nothing, pick('eyes')), { switch: true, mode: 'plan', agent: 'plan', model: pick('eyes'), fit: null, note: 'no line fits clearly, so the chat\'s model stays' });
  for (const current of [null, pick('other'), pick('eyes', 'high')])
    assert.deepEqual(route(noLine, three, models, nothing, current), { switch: true, mode: 'plan', agent: 'plan', model: pick('plan'), fit: null, note: 'no line fits clearly, so the first model is used' });
  const weak = sure('plan', 0.9, { plan: { index: 1, confidence: 0.3 } });
  assert.equal((route(weak, three, models, nothing, pick('eyes')) as { note: string }).note, 'no line fits clearly, so the chat\'s model stays');
});

test('a missing line answer, or one that names a line that is not there, falls back the same way', () => {
  for (const lines of [{}, { plan: { index: 3, confidence: 0.9 } }, { plan: { index: -1, confidence: 0.9 } }, { execute: { index: 1, confidence: 0.9 } }]) {
    assert.deepEqual(route(sure('plan', 0.9, lines), three, models, nothing, pick('deep')), { switch: true, mode: 'plan', agent: 'plan', model: pick('deep'), fit: null, note: 'no answer about the lines, so the chat\'s model stays' });
    assert.deepEqual(route(sure('plan', 0.9, lines), three, models, nothing, null), { switch: true, mode: 'plan', agent: 'plan', model: pick('plan'), fit: null, note: 'no answer about the lines, so the first model is used' });
  }
});

test('a mode the decider was not sure about uses the Plan line', () => {
  const answer = sure('execute', 0.4, { plan: { index: 1, confidence: 0.7 }, execute: { index: 0, confidence: 0.99 } });
  assert.deepEqual(route(answer, three, models, nothing, null), { switch: true, mode: 'plan', agent: 'plan', model: pick('deep'), fit: 0.7, note: 'not sure, so Plan' });
  assert.deepEqual((route(sure('execute', 0.4), three, models, nothing, null) as { note: string }).note, 'not sure, so Plan; no answer about the lines, so the first model is used');
});

test('the lines count only the models that can be used now and have a line', () => {
  const list = [entry('gone', 'not offered'), entry('plan'), entry('deep', 'hard design'), entry('eyes', 'screens')];
  const { usable, note } = candidates('plan', list, models, nothing);
  assert.deepEqual([usable.map(item => item.id), note], [['plan', 'deep', 'eyes'], null]);
  assert.deepEqual(described(usable).map(item => item.id), ['deep', 'eyes']);
  assert.deepEqual(linesFor(withPlan(...list), models, nothing), { plan: ['hard design', 'screens'] });
  assert.deepEqual((route(sure('plan', 0.9, { plan: { index: 0, confidence: 0.9 } }), withPlan(...list), models, nothing, null) as { model: unknown }).model, pick('deep'));
  assert.deepEqual(candidates('plan', list, models, { needsImage: true, tokens: 0 }).usable.map(item => item.id), ['eyes']);
});

test('lines are asked about only where there is a choice to make, and at most eight', () => {
  assert.equal(MAX_LINES, 8);
  assert.deepEqual(linesFor(settings, models, nothing), {}, 'one model each');
  assert.deepEqual(linesFor(withPlan(entry('plan'), entry('deep')), models, nothing), {}, 'two models, no line');
  assert.deepEqual(linesFor(withPlan(entry('plan', 'only this one')), models, nothing), {}, 'a line, one model');
  assert.deepEqual(linesFor(withPlan(entry('plan'), entry('deep', 'hard design')), models, nothing), { plan: ['hard design'] });
  assert.deepEqual(linesFor(three, models, { needsImage: true, tokens: 0 }), {}, 'a picture leaves one model');
  const many = Array.from({ length: 10 }, (_, index) => entry(`m${index}`, `line ${index}`));
  const all = { modes: { plan: many, execute: many, review: many } }, offeredNow = many.map(item => m(item.id));
  assert.deepEqual(linesFor(all, offeredNow, nothing), { plan: many.slice(0, 8).map(item => item.useFor), execute: many.slice(0, 8).map(item => item.useFor), review: many.slice(0, 8).map(item => item.useFor) });
  assert.deepEqual((route(sure('plan', 0.9, { plan: { index: 7, confidence: 0.9 } }), all, offeredNow, nothing, null) as { model: unknown }).model, pick('m7'));
  assert.equal((route(sure('plan', 0.9, { plan: { index: 8, confidence: 0.9 } }), all, offeredNow, nothing, null) as { note: string }).note, 'no answer about the lines, so the first model is used');
});

test('checks are routed only with a decider and a usable Review model', () => {
  const full = { ...settings, decider: pick('judge') };
  assert.deepEqual(checksStatus(full, models), { active: true, note: null });
  assert.deepEqual(checksStatus({ ...full, decider: null }, models), { active: false, note: 'no decider chosen' });
  assert.deepEqual(checksStatus({ ...full, modes: { ...full.modes, review: [] } }, models), { active: false, note: 'no model chosen for Review' });
  assert.deepEqual(checksStatus({ ...full, modes: { ...full.modes, review: [entry('gone')] } }, models), { active: false, note: 'no chosen Review model is offered right now' });
});

test('the review rules hold the four points', () => {
  for (const point of [/concrete evidence/, /verdict/, /earlier blocking findings/, /at most three checks/]) assert.match(reviewRules, point);
  assert.equal(REVIEW_RULES_KEY, 'relay-review-rules');
});

test('a cut text never ends inside a two-unit character', () => {
  assert.equal(safeHead('abcdef', 4), 'abcd');
  assert.equal(safeHead('abcdef', 10), 'abcdef');
  const emoji = `${'a'.repeat(3)}\u{1F600}`;   // the cut at 4 would otherwise fall inside the emoji
  assert.equal(safeHead(emoji, 4), 'aaa');
  assert.equal(safeHead(emoji, 5), emoji);
});

test('a failure\'s note is cut at 200 characters and never ends inside a two-unit character', () => {
  assert.equal(brief(new Error('boom')), 'boom');
  assert.equal(brief(new Error(`long\n${'x'.repeat(400)}`)), `long ${'x'.repeat(195)}`);
  const atTheCut = `${'x'.repeat(199)}\u{1F600}more`;
  assert.doesNotThrow(() => encodeURIComponent(brief(new Error(atTheCut))));
});

// The whole chat must fit the model. `exec` holds 1,000 tokens and `big` 100,000.
const two = { modes: { ...settings.modes, execute: [entry('exec', 'small changes'), entry('big', 'large changes')] } };
const sized = (tokens: number, files = 0) => ({ needsImage: false, tokens: files, chat: { tokens, answered: [] } });
const fits = (tokens: number, files = 0, current: ReturnType<typeof pick> | null = null) => candidates('execute', two.modes.execute, models, sized(tokens, files), current).usable.map(choice => choice.id);

test('a chat is moved only to a model it fits, with the room OpenCode keeps free before it compacts', () => {
  assert.deepEqual(fits(850), ['exec', 'big'], 'a small model keeps 15% free');
  assert.deepEqual(fits(851), ['big']);
  assert.deepEqual(fits(84_000), ['big'], 'a model of 32,000 tokens or more keeps at least 16,000 free');
  assert.deepEqual(candidates('execute', two.modes.execute, models, sized(84_001)), { usable: [], note: 'this chat is too long for every chosen Execute model' });
  assert.deepEqual(fits(80_000, 4001), [], 'the attached files come on top of the chat');
  assert.deepEqual(fits(84_001, 0, pick('big')), ['big'], 'the model the chat is on already holds it');
  assert.deepEqual(fits(84_001, 0, pick('big', 'high')), ['big'], 'whatever its effort');
  const unlisted = [m('exec', ['text'], { limit: { context: 0 } })];
  assert.deepEqual(candidates('execute', two.modes.execute, unlisted, sized(5_000_000)).usable.map(choice => choice.id), ['exec'], 'a model whose size is not listed is kept');
  for (const chat of [null, undefined]) assert.deepEqual(candidates('execute', two.modes.execute, models, { needsImage: false, tokens: 0, chat }).usable.map(choice => choice.id), ['exec', 'big'], 'a chat whose size is not known is not measured');
});

test('the lines asked about and the route use the same fit, so a line still points at its model', () => {
  const second = sure('execute', 0.9, { execute: { index: 1, confidence: 0.8 } });
  assert.deepEqual(linesFor(two, models, sized(851)), {}, 'one model left: nothing to ask');
  assert.deepEqual(linesFor(two, models, sized(851), pick('exec')), { execute: ['small changes', 'large changes'] });
  assert.deepEqual(route(second, two, models, sized(851), pick('exec')), { switch: true, mode: 'execute', agent: 'build', model: pick('big'), fit: 0.8, note: null });
  assert.deepEqual(route(second, two, models, sized(90_000), null), { switch: false, mode: 'execute', note: 'this chat is too long for every chosen Execute model' });
});

// Stay or go. Prices are those of the worked examples in docs/research/2026-11-17-relay-cost-and-model-choice.md (section 4.2 and Appendix B), in USD per million tokens.
const price = (input: string | null, output: string | null, read: string | null, write: string | null, steps: object[] = []) => ({ inputPerMillion: input, outputPerMillion: output, cacheReadPerMillion: read, cacheWritePerMillion: write, tiered: steps.length > 0, steps });
const wide = (id: string, cost?: object) => m(id, ['text'], { limit: { context: 1_000_000 }, ...(cost ? { cost } : {}) });
const priced = [
  wide('opus', price('4', '20', '0.2', '5')), wide('sonnet', price('2', '10', '0.1', '2.5')),
  wide('haiku', price('0.1', '0.5', '0.01', '0.125', [{ above: 100_000, inputPerMillion: '0.5', outputPerMillion: '2.5', cacheReadPerMillion: '0.05', cacheWritePerMillion: '0.625' }])),
  wide('flash', price('0.3', '1.2', '0.006', '0.3')), wide('zero', price('0', '0', '0', '0')), wide('bare'),
  wide('plain', price('2', '10', null, null)), wide('cheap', price('0.4', '2', null, null)),
];
type Extra = { agoMs?: number; answered?: object[]; past?: object[]; current?: ReturnType<typeof pick> | null; chat?: object | null };
/** A chat of `tokens` on `from`, which answered a minute ago. The decider's line points at `to`, the second model of the Execute list. */
function move(from: string, to: string, tokens: number, extra: Extra = {}) {
  const chat = extra.chat === undefined ? { tokens, answered: [{ providerID: 'p', id: from, tokens, agoMs: extra.agoMs ?? 60_000 }, ...(extra.answered ?? [])] } : extra.chat;
  const lists = { modes: { ...settings.modes, execute: [entry(from, 'the usual work'), entry(to, 'small, clear changes')] } };
  return route(sure('execute', 0.9, { execute: { index: 1, confidence: 0.8 } }), lists, priced as never, { needsImage: false, tokens: 0, chat, past: extra.past } as never, extra.current === undefined ? pick(from) : extra.current);
}
const went = (result: ReturnType<typeof route>) => result.switch ? [result.model.id, result.note] : ['no switch', result.note];

test('a step down to a cheaper model happens only when it pays', () => {
  for (const [from, to, tokens, goes] of [
    ['sonnet', 'haiku', 20_000, true], ['sonnet', 'haiku', 60_000, true], ['sonnet', 'haiku', 95_000, true], ['sonnet', 'haiku', 101_000, false], ['sonnet', 'haiku', 150_000, false],
    ['opus', 'sonnet', 60_000, false], ['opus', 'flash', 35_000, true], ['opus', 'flash', 62_000, true],
  ] as const) assert.equal(went(move(from, to, tokens))[0], goes ? to : from, `${from} to ${to} at ${tokens} tokens`);
});

test("when a step down does not pay, the chat's model stays for this message, the mode still sets the agent, and the note says why", () => {
  assert.deepEqual(move('opus', 'sonnet', 60_000), { switch: true, mode: 'execute', agent: 'build', model: pick('opus'), fit: null,
    note: "moving this chat to p/sonnet would cost about $0.14 to read it again and save about $0.09 over 6 requests, so the chat's model stays" });
});

test('what the picked model still holds of the chat is not read again', () => {
  const held = (agoMs: number) => move('opus', 'sonnet', 100_000, { answered: [{ providerID: 'p', id: 'sonnet', tokens: 92_000, agoMs }] });
  assert.equal(went(move('opus', 'sonnet', 100_000))[0], 'opus');
  assert.equal(went(held(120_000))[0], 'sonnet', 'all but 8,000 tokens are still in its cache');
  assert.equal(went(held(300_001))[0], 'opus', 'after five minutes its cache is gone');
});

test('the usual number of requests comes from the records of that line, once there are three', () => {
  const took = (requests: number, model = 'p/sonnet', mode = 'execute') => ({ mode, model, reply: { requests, fresh: 0, cached: 0, costUsd: null, seconds: null } });
  assert.equal(went(move('opus', 'sonnet', 36_000))[0], 'opus', 'six requests do not pay');
  assert.equal(went(move('opus', 'sonnet', 36_000, { past: [took(18), took(30), took(4)] }))[0], 'sonnet', 'the middle one of three, 18, pays');
  assert.equal(went(move('opus', 'sonnet', 36_000, { past: [took(18), took(30), took(18, 'p/haiku'), took(18, 'p/sonnet', 'plan'), { mode: 'execute', model: 'p/sonnet', reply: null }] }))[0], 'opus', 'two records of that line are too few');
});

test('with nothing to lose, or nothing to compare, the line is followed', () => {
  assert.deepEqual(went(move('opus', 'sonnet', 60_000, { agoMs: 300_001 })), ['sonnet', null], "the chat's own cache is older than five minutes");
  assert.equal(went(move('opus', 'sonnet', 60_000, { agoMs: 300_000 }))[0], 'opus', 'five minutes itself is still live');
  assert.deepEqual(went(move('opus', 'sonnet', 60_000, { chat: { tokens: 0, answered: [] } })), ['sonnet', null], 'a new chat, or one just compacted');
  assert.deepEqual(went(move('opus', 'sonnet', 60_000, { chat: { tokens: 60_000, answered: [{ providerID: 'p', id: 'flash', tokens: 60_000, agoMs: 1000 }, { providerID: 'p', id: 'opus', tokens: 50_000, agoMs: 9000 }] } })), ['sonnet', null], "the last answer was not the chat's model's");
  assert.deepEqual(went(move('haiku', 'sonnet', 60_000)), ['sonnet', null], 'a step up is what the line asked for');
  assert.deepEqual(went(move('plain', 'cheap', 150_000)), ['cheap', null], 'with no cached-read price there is no cache to lose');
  assert.deepEqual(went(move('opus', 'sonnet', 60_000, { current: pick('review') })), ['sonnet', null], "the chat's model is not one of this mode's models");
  assert.deepEqual(went(move('opus', 'sonnet', 60_000, { current: null })), ['sonnet', null], "the chat's model is not known");
});

test('a missing price or a size that could not be read means no cost check, and the note says so', () => {
  assert.deepEqual(went(move('opus', 'zero', 60_000)), ['zero', 'no price listed, so no cost check'], '$0 can mean not listed');
  assert.deepEqual(went(move('bare', 'sonnet', 60_000)), ['sonnet', 'no price listed, so no cost check']);
  assert.deepEqual(went(move('opus', 'sonnet', 60_000, { chat: null })), ['sonnet', "the chat's size could not be read, so no cost check"]);
  assert.deepEqual(went(move('opus', 'sonnet', 60_000, { chat: null, current: pick('review') })), ['sonnet', null], 'nothing would have been checked anyway');
});

test('another effort of the same model is not a step down', () => {
  const lists = { modes: { ...settings.modes, execute: [entry('opus', 'the usual work'), entry('opus', 'hard problems', 'high')] } };
  const result = route(sure('execute', 0.9, { execute: { index: 1, confidence: 0.8 } }), lists, priced as never, { needsImage: false, tokens: 0, chat: { tokens: 60_000, answered: [{ providerID: 'p', id: 'opus', tokens: 60_000, agoMs: 1000 }] } }, pick('opus'));
  assert.deepEqual(result, { switch: true, mode: 'execute', agent: 'build', model: pick('opus', 'high'), fit: 0.8, note: null });
});
