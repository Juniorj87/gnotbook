import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

const PORT = 49997;
const BASE = `http://127.0.0.1:${PORT}`;

let server;
test.before(async () => {
  server = spawn(process.execPath, ['server.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), MORROW_ADMIN_TOKEN: 'test-admin-token-not-a-secret-in-prod' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  // Wait for the server to accept connections.
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok) return;
    } catch {}
    await wait(250);
  }
  throw new Error('server did not start');
});
test.after(async () => {
  if (server && !server.killed) {
    server.kill();
    await wait(200);
  }
});

test('healthz reports a running process', async () => {
  const r = await fetch(`${BASE}/healthz`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.chainId, process.env.GNOLAND_CHAIN_ID || 'gnoland-1');
  assert.equal(typeof j.uptimeSeconds, 'number');
});

test('config exposes no secrets and the Moonbound invariants', async () => {
  const r = await fetch(`${BASE}/api/config`);
  assert.equal(r.status, 200);
  const j = await r.json();
  const raw = JSON.stringify(j);
  assert.ok(!raw.includes('test-admin-token-not-a-secret-in-prod'), 'admin token leaked');
  assert.ok(!raw.includes(process.env.PINATA_JWT || 'PINATA_JWT_PLACEHOLDER'), 'pinata jwt leaked');
  assert.equal(j.moonbound.maxSupply, 1111);
  assert.equal(j.moonbound.mintPriceUgnot, 575000000);
  assert.equal(j.marketplaceFeeBps, 250);
  assert.equal(j.collectionServiceFeeUgnot, 2000000000);
});

test('traits endpoint serves the pinned 1,111 editions', async () => {
  const r = await fetch(`${BASE}/api/traits?collection=moonbound`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.total, 1111);
  assert.equal(j.groups.length, 7);
  const rarity = j.groups.find((g) => g.trait_type === 'Rarity');
  assert.ok(rarity, 'Rarity group missing');
  assert.equal(rarity.values.find((v) => v.value === 'Mythic')?.count, 11);
  assert.equal(rarity.values.find((v) => v.value === 'Common')?.count, 546);
  assert.equal(Object.keys(j.editions).length, 1111);
});

test('traits endpoint rejects unknown collections', async () => {
  const r = await fetch(`${BASE}/api/traits?collection=not-a-drop`);
  assert.equal(r.status, 404);
});

test('realm-read is restricted to registered collections and an allowlist', async () => {
  // Arbitrary package -> 404 (not registered).
  const r1 = await fetch(`${BASE}/api/realm-read?pkg=gno.land/r/evil/realm&func=Name`);
  assert.ok(r1.status === 400 || r1.status === 404, `expected 4xx, got ${r1.status}`);
  // Disallowed function name -> 400 even for a syntactically valid package.
  const r2 = await fetch(`${BASE}/api/realm-read?pkg=gno.land/r/g1probe0000000000000000000000000000/moonbound&func=eval`);
  assert.equal(r2.status, 400);
});

test('collection-items requires a valid package', async () => {
  const r = await fetch(`${BASE}/api/collection-items`);
  assert.equal(r.status, 400);
});

test('market endpoint returns a shaped response', async () => {
  const r = await fetch(`${BASE}/api/market`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(Array.isArray(j.collections));
  assert.ok(Array.isArray(j.listings));
});

test('sale-total fee math (2.5% floor in ugnot)', () => {
  // Mirrors public/app.js saleTotal: fee = floor(price/40); total = price + fee.
  const cases = [
    [1_000_000, 25_000, 1_025_000],
    [575_000_000, 14_375_000, 589_375_000],
    [1, 0, 1],
    [39, 0, 39],
    [40, 1, 41]
  ];
  for (const [price, fee, total] of cases) {
    const f = Math.floor(price / 40);
    assert.equal(f, fee, `fee mismatch for ${price}`);
    assert.equal(price + f, total, `total mismatch for ${price}`);
  }
});