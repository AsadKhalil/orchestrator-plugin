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
