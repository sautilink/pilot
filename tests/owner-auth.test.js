import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerAuth } from '../src/owner-auth.js';
import { TestD1 } from './helpers/d1.js';

const ACTOR = { id: 10001, username: 'drcharlestz', is_bot: false, chatId: 10001, chatType: 'private' };
const codeFrom = pair => pair.command.split(' ')[1];
async function fixture(t) {
  const db = new TestD1();
  let now = 1792584000;
  const owner = createOwnerAuth({ db, clock: () => now });
  t.after(() => db.close());
  return { db, owner, advance: seconds => { now += seconds; } };
}

test('username alone never grants access; private pairing binds a permanent numeric ID', async t => {
  const { owner, db } = await fixture(t);
  assert.equal(await owner.isOwner(ACTOR), false);
  assert.deepEqual(await owner.status(), { bound: false, expectedUsername: 'drcharlestz' });
  const pair = await owner.beginPairing(), code = codeFrom(pair);
  assert.equal(code.length, 64);
  const stored = await db.prepare('SELECT * FROM pilot_owner').first();
  assert.ok(!JSON.stringify(stored).includes(code), 'only a digest is retained');
  await assert.rejects(owner.claim({ ...ACTOR, username: 'different_name' }, code), { code: 'owner_username_required' });
  await assert.rejects(owner.claim(ACTOR, '0'.repeat(64)), { code: 'owner_claim_invalid' });
  assert.deepEqual(await owner.claim(ACTOR, code), { ok: true, userId: '10001' });
  assert.equal(await owner.isOwner({ ...ACTOR, username: 'changed_name' }), true);
  assert.equal(await owner.isOwner({ ...ACTOR, id: 10002 }), false, 'a later holder of the same username has no access');
  assert.deepEqual(await owner.status(), { bound: true, userId: '10001', expectedUsername: 'drcharlestz' });
  const claimed = await db.prepare('SELECT * FROM pilot_owner').first();
  assert.equal(claimed.pair_hash, null);
  await assert.rejects(owner.beginPairing(), { code: 'owner_bound' });
  await assert.rejects(owner.claim({ ...ACTOR, id: 10002, chatId: 10002 }, code), { code: 'owner_bound' });
  assert.equal((await owner.claim(ACTOR, code)).ok, true, 'a Telegram replay is harmless');
});

test('expired, renewed and malformed pairing codes cannot claim ownership', async t => {
  const { owner, advance } = await fixture(t);
  const first = await owner.beginPairing();
  await assert.rejects(owner.beginPairing(), { code: 'owner_pair_rate_limited' });
  advance(31);
  const second = await owner.beginPairing();
  await assert.rejects(owner.claim(ACTOR, codeFrom(first)), { code: 'owner_claim_invalid' });
  for (const code of [null, '', codeFrom(second) + 'x', '/claimowner ' + codeFrom(second)]) {
    await assert.rejects(owner.claim(ACTOR, code), { code: 'owner_claim_invalid' });
  }
  advance(600);
  await assert.rejects(owner.claim(ACTOR, codeFrom(second)), { code: 'owner_claim_expired' });
  assert.equal(await owner.isOwner(ACTOR), false);
  await owner.cleanup();
  await assert.rejects(owner.claim(ACTOR, codeFrom(second)), { code: 'owner_claim_invalid' });
});

test('bot actors and unsafe or coerced IDs cannot be paired or authorized', async t => {
  const { owner } = await fixture(t);
  const pair = await owner.beginPairing();
  for (const actor of [null, { ...ACTOR, is_bot: true }, { ...ACTOR, id: '10001' }, { ...ACTOR, id: -1 }, { ...ACTOR, id: 0 }, { ...ACTOR, id: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.equal(await owner.isOwner(actor), false);
    await assert.rejects(owner.claim(actor, codeFrom(pair)), { code: 'owner_private_required' });
  }
  await assert.rejects(owner.claim({ ...ACTOR, chatId: 10002 }, codeFrom(pair)), { code: 'owner_private_required' });
  await assert.rejects(owner.claim({ ...ACTOR, chatType: 'group' }, codeFrom(pair)), { code: 'owner_private_required' });
  assert.equal((await owner.claim({ ...ACTOR, username: 'DrCharlesTZ' }, codeFrom(pair))).ok, true);
});

test('competing claims consume the pairing capability once, without switching ownership', async t => {
  const { owner } = await fixture(t);
  const pair = await owner.beginPairing();
  const results = await Promise.allSettled([
    owner.claim(ACTOR, codeFrom(pair)),
    owner.claim({ ...ACTOR, id: 10002, chatId: 10002 }, codeFrom(pair)),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const status = await owner.status();
  assert.equal(await owner.isOwner({ ...ACTOR, id: Number(status.userId) }), true);
  assert.equal(await owner.isOwner({ ...ACTOR, id: status.userId === '10001' ? 10002 : 10001 }), false);
});
