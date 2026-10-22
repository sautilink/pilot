import test from 'node:test';
import assert from 'node:assert/strict';
import { routeBroadcast } from '../src/broadcast-router.js';

const ACTOR = { id: 101, is_bot: false, chatId: 101, chatType: 'private' };
test('broadcast routing rejects group, synthetic and mismatched private actors before mutation', async () => {
  for (const actor of [undefined, { ...ACTOR, id: -1 }, { ...ACTOR, id: '101' }, { ...ACTOR, chatType: 'supergroup' }, { ...ACTOR, chatId: 102 }, { ...ACTOR, is_bot: true }]) {
    await assert.rejects(routeBroadcast({ payload: { actor, action: 'claim', input: { code: 'unused' } }, owner: { claim: () => assert.fail('must not run') } }), { code: 'owner_private_required' });
  }
});
test('broadcast router cannot dispatch arbitrary service methods or replace the verified actor', async () => {
  for (const action of ['drain', 'nextRunAt', 'beginPairing', 'constructor', 'toString', 'wake']) {
    await assert.rejects(routeBroadcast({ payload: { actor: ACTOR, action }, service: {} }), { code: 'broadcast_action_invalid' });
  }
  const received = [];
  await routeBroadcast({ service: { confirm: async input => received.push(input) }, payload: {
    actor: ACTOR, action: 'confirm', input: { actor: { id: 666 }, id: 'draft', previewMessageId: 44, content: 'changed', chat_id: -1 },
  } });
  assert.deepEqual(received, [{ actor: ACTOR, id: 'draft', previewMessageId: 44 }]);
});
