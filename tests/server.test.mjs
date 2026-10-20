import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Static server-source invariants that do not need a running process.
test('the public catalog defaults to an empty store and the server parses whitelists itself', async () => {
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.ok(server.includes('const DEFAULT_COLLECTIONS = []'), 'no bundled demo collections may ship');
  assert.match(server, /function parseWhitelistText\(/);
  assert.match(server, /10_000|10000/, 'whitelist size cap must be enforced');
  assert.match(server, /launchStatus/); // DRAFT | PUBLISHED lifecycle exists
  assert.doesNotMatch(server, /res\.(json|send)\([^)]*whitelist\.addresses/, 'whitelist addresses are never published');
});

test('balances and the portfolio read the real on-chain shapes', async () => {
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  // The public RPC answers bank/balances with a bare "<amount><denom>" string.
  assert.match(server, /function parseBalances\(/);
  assert.ok(server.includes("typeof parsed === 'string'"), 'the string balance form must be handled');
  assert.ok(server.includes('/^(\\d+(?:\\.\\d+)?)\\s*([a-zA-Z]'), 'the amount and denom must be split');
  // A wallet that only holds NFTs from a realm outside the public catalog must still be scanned.
  assert.match(server, /EXTERNAL_PROJECTS\.map/, 'the portfolio must scan the external project realms');
  assert.match(server, /MOONBOUND_COLLECTION_PATH/, 'the portfolio must scan the pinned collection realm');
  // A token id is a string argument for the realm, not a number literal.
  assert.match(server, /const tokenIdArg = `"/, 'TokenURI must be called with a quoted id');
});

const PORT = 49997;
const BASE = `http://127.0.0.1:${PORT}`;
// Every spawned test server writes to the same scratch store, never to the real data/store.json.
const scratchStore = join(tmpdir(), `gnotbook-test-store-${process.pid}.json`);

let server;
test.before(async () => {
  server = spawn(process.execPath, ['server.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), MORROW_ADMIN_TOKEN: 'test-admin-token-not-a-secret-in-prod', MORROW_STORE_PATH: scratchStore },
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

test('api health endpoint reports chain and persistence mode', async () => {
  const r = await fetch(`${BASE}/api/health`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(typeof j.uptimeSeconds, 'number');
  assert.equal(typeof j.persistenceMode, 'string');
});

test('favicon returns 204 no content without error', async () => {
  const r = await fetch(`${BASE}/favicon.ico`);
  assert.equal(r.status, 204);
});

test('config exposes no secrets and the Moonbound invariants', async () => {
  const r = await fetch(`${BASE}/api/config`);
  assert.equal(r.status, 200);
  const j = await r.json();
  const raw = JSON.stringify(j);
  assert.ok(!raw.includes('test-admin-token-not-a-secret-in-prod'), 'admin token leaked');
  assert.ok(!raw.includes(process.env.PINATA_JWT || 'PINATA_JWT_PLACEHOLDER'), 'pinata jwt leaked');
  assert.equal(j.moonbound.maxSupply, 1000);
  assert.equal(j.moonbound.mintPriceUgnot, 5000000);
  assert.equal(j.marketplaceFeeBps, 250);
  assert.equal(j.collectionServiceFeeUgnot, 5000000);
  // No registry is configured in this test environment, so there is no admin wallet to exempt yet.
  assert.equal(j.adminWallet, '');
});

test('traits endpoint serves the pinned 1,000 editions', async () => {
  const r = await fetch(`${BASE}/api/traits?collection=moonbound`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.total, 1000);
  assert.equal(j.groups.length, 7);
  const rarity = j.groups.find((g) => g.trait_type === 'Rarity');
  assert.ok(rarity, 'Rarity group missing');
  assert.equal(rarity.values.find((v) => v.value === 'Mythic')?.count, 14);
  assert.equal(rarity.values.find((v) => v.value === 'Common')?.count, 539);
  assert.equal(Object.keys(j.editions).length, 1000);
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

test('config exposes a usable founder reserve', async () => {
  const r = await fetch(`${BASE}/api/config`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(Number.isInteger(j.moonbound.founderReserve) && j.moonbound.founderReserve >= 0 && j.moonbound.founderReserve <= 333,
    'founder reserve must be an integer inside the contract cap of 333');
  if (j.moonbound.founderReserve > 0) {
    assert.match(j.moonbound.founderAddress, /^g1[a-z0-9]{20,}$/,
      'a configured reserve needs a founder wallet, or editions #0001+ stay unminted');
  }
});

test('external project entries point at a real realm and never overstate supply', async () => {
  const j = await (await fetch(`${BASE}/api/config`)).json();
  assert.ok(Array.isArray(j.projects) && j.projects.length >= 1, 'config must expose the external project list');
  const guardians = j.projects.find((p) => p.slug === 'guardians');
  assert.ok(guardians, 'Guardians must be listed');
  assert.match(guardians.realm, /^gno\.land\/r\/[a-z0-9]+\/[a-z0-9_]+$/i);
  assert.match(guardians.site, /^https:\/\//);
  assert.match(guardians.twitter, /^https:\/\//);
  if (guardians.onchain) {
    assert.ok(Number.isInteger(guardians.onchain.minted) && guardians.onchain.minted >= 0);
    assert.ok(guardians.onchain.maxSupply >= guardians.onchain.minted, 'minted supply cannot exceed max supply');
  }
});

test('market endpoint returns a shaped response', async () => {
  const r = await fetch(`${BASE}/api/market`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(Array.isArray(j.collections));
  assert.ok(Array.isArray(j.listings));
});

test('collection manifest exposes the verified Octopin directory CIDs', async () => {
  const r = await fetch(`${BASE}/api/collection-manifest`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.supply, 1000);
  assert.equal(j.founderReserve, 333);
  assert.equal(j.pinned, true);
  assert.equal(j.tokenCount, 1000);
  assert.match(j.imageBaseUri, /^ipfs:\/\/[A-Za-z0-9]+\/$/);
  assert.match(j.metadataBaseUri, /^ipfs:\/\/[A-Za-z0-9]+\/$/);
  assert.ok(!JSON.stringify(j).includes('IMAGE_DIRECTORY_CID'));
});

test('sale-total fee math (2.5% floor in ugnot)', () => {
  // Mirrors public/app.js saleTotal: fee = floor(price/40); total = price + fee.
  const cases = [
    [1_000_000, 25_000, 1_025_000],
    [5_000_000, 125_000, 5_125_000],
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

test('market starts empty: no bundled demo collections and no drafts', async () => {
  const r = await fetch(`${BASE}/api/market`);
  const j = await r.json();
  assert.equal(j.collections.length, 0, 'the public catalog must start empty');
});

test('save collection draft accepts schedule, mint type and a deduplicated whitelist, and never leaks addresses', async () => {
  const whitelistText = [
    '',
    'G1JGNXCRPRAK4YVJZ4QYY4TMDN2V7GZL4DYRRTX2NVCRA5SVOJLDGRT',
    'g1jgnxcrprak4yvjz4qyy4tmdn2v7gzl4dyrrtx2nvcra5svojldgrt   ',
    'not-a-wallet',
    'g1zqgfjgvdfnrstqfs7zn39qgz4m3ctnevaw7a6gwe9f0vy3tzvt6wysgmw4qnhfrn4vfe',
    'g1zqgfjgvdfnrstqfs7zn39qgz4m3ctnevaw7a6gwe9f0vy3tzvt6wysgmw4qnhfrn4vfe',
  ].join('\n');
  const future = new Date(Date.now() + 3600_000).toISOString();
  const r = await fetch(`${BASE}/api/collections/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test Garden', symbol: 'GARDEN', slug: 'test-garden',
      mintType: 'paid', mintPriceUgnot: 5_000_000, maxSupply: 500, royaltyBps: 200,
      website: 'https://example.test', mintStartAt: future, creator: '',
      whitelistText
    })
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.collection.launchStatus, 'DRAFT');
  assert.equal(j.collection.mintStartAt, future);
  assert.equal(j.whitelist.count, 2, 'malformed and duplicate lines are dropped');
});

test('draft save rejects a past schedule, a bad website and an all-invalid whitelist', async () => {
  const future = new Date(Date.now() + 3600_000).toISOString();
  const payloads = [
    { name: 'X', symbol: 'X1', slug: 'past-mint', mintStartAt: new Date(Date.now() - 3_600_000).toISOString() },
    { name: 'X', symbol: 'X1', slug: 'bad-site', website: 'ftp://nope', mintStartAt: future },
    { name: 'X', symbol: 'X1', slug: 'bad-wl', mintStartAt: future, whitelistText: 'not-a-wallet\nalso-bad' },
  ];
  for (const body of payloads) {
    const r = await fetch(`${BASE}/api/collections/create`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    assert.equal(r.status, 400);
  }
});

test('the saved draft and its allowlist count appear publicly without any addresses', async () => {
  const r = await fetch(`${BASE}/api/market`);
  const j = await r.json();
  const drafted = j.collections.find(c => c.slug === 'test-garden');
  assert.ok(drafted, 'the draft must be publicly visible in the catalog');
  assert.equal(drafted.launchStatus, 'DRAFT');
  assert.equal(drafted.mintType, 'paid');
  assert.equal(drafted.allowlistCount, 2);
  assert.equal(drafted.allowlistPrepared, true);
  assert.ok(!JSON.stringify(j).includes('"addresses"'), 'addresses must never leave the server');
  assert.ok(!JSON.stringify(j).includes('G1JGNXCRPRAK4'), 'raw wallet strings must never leave the server');
});