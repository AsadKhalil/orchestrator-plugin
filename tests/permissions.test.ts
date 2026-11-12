import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restrictRoleAction } from '../src/permissions.js';

test('only tightens owned read-only role permissions', async () => {
  const lookup = async (id: string) => id === 'owned' ? 'planner' as const : null;
  const read = { sessionID: 'owned', action: 'read', effect: 'ask' as 'allow' | 'ask' | 'deny' };
  await restrictRoleAction(read, lookup);
  assert.equal(read.effect, 'ask');
  const edit = { sessionID: 'owned', action: 'edit', effect: 'allow' as 'allow' | 'ask' | 'deny' };
  await restrictRoleAction(edit, lookup);
  assert.equal(edit.effect, 'deny');
  const unrelated = { sessionID: 'other', action: 'edit', effect: 'allow' as 'allow' | 'ask' | 'deny' };
  await restrictRoleAction(unrelated, lookup);
  assert.equal(unrelated.effect, 'allow');
});

test('unknown owned role cannot obtain permissions and lookup failures propagate', async () => {
  const request = { sessionID: 'owned', action: 'read', effect: 'allow' as 'allow' | 'ask' | 'deny' };
  await restrictRoleAction(request, async () => 'unknown');
  assert.equal(request.effect, 'deny');
  await assert.rejects(restrictRoleAction(request, async () => { throw new Error('storage error'); }), /storage error/);
});

test('an explicit coder profile can only narrow the host decision', async () => {
  const lookup = async () => 'coder' as const;
  const profile = { allowedActions: ['read', 'edit', 'shell', 'subagent'] };
  for (const effect of ['allow', 'ask', 'deny'] as const) {
    const event = { sessionID: 'owned', action: 'edit', effect: effect as 'allow' | 'ask' | 'deny' };
    await restrictRoleAction(event, lookup, profile);
    assert.equal(event.effect, effect);
  }
  const blocked = { sessionID: 'owned', action: 'subagent', effect: 'allow' as 'allow' | 'ask' | 'deny' };
  await restrictRoleAction(blocked, lookup, profile);
  assert.equal(blocked.effect, 'deny');
  const defaultDeny = { sessionID: 'owned', action: 'edit', effect: 'allow' as 'allow' | 'ask' | 'deny' };
  await restrictRoleAction(defaultDeny, lookup);
  assert.equal(defaultDeny.effect, 'deny');
});
