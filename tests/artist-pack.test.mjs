import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/artist-pack.js', import.meta.url), 'utf8');
function loadPack() {
  const sandbox = { window: {}, TextEncoder, Uint8Array, Uint32Array, DataView, Blob, Date, Map, document: {} };
  vm.runInNewContext(source, sandbox, { timeout: 2000 });
  return sandbox.window.MorrowArtistPack;
}

test('artist image pack is a real ZIP with numbered edition files and a manifest', async () => {
  const pack = loadPack();
  const blob = await pack.imagesZip([
    { id: 1, fileName: '0001.webp', blob: new Blob(['one'], { type: 'image/webp' }), bytes: 3, width: 1, height: 1 },
    { id: 2, fileName: '0002.webp', blob: new Blob(['two'], { type: 'image/webp' }), bytes: 3, width: 1, height: 1 }
  ], 'Test collection');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'PK\u0003\u0004');
  const text = new TextDecoder().decode(bytes);
  assert.ok(text.includes('images/0001.webp'));
  assert.ok(text.includes('images/0002.webp'));
  assert.ok(text.includes('package-manifest.json'));
});

test('artist metadata pack uses matching IPFS image paths and collection metadata', async () => {
  const pack = loadPack();
  const root = 'bafybeiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const blob = await pack.metadataZip([
    { id: 1, fileName: '0001.webp', blob: new Blob(['one'], { type: 'image/webp' }), bytes: 3, width: 1, height: 1 },
    { id: 2, fileName: '0002.webp', blob: new Blob(['two'], { type: 'image/webp' }), bytes: 3, width: 1, height: 1 }
  ], { imageBaseCid: root, name: 'Test collection', description: 'Artist description' });
  const text = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
  assert.ok(text.includes(`ipfs://${root}/0001.webp`));
  assert.ok(text.includes(`ipfs://${root}/0002.webp`));
  assert.ok(text.includes('metadata/collection.json'));
  assert.ok(text.includes('metadata/0001.json'));
});

test('zero-percent creator royalty is preserved in collection metadata', async () => {
  const pack = loadPack();
  const root = 'bafybeiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const blob = await pack.metadataZip([
    { id: 1, fileName: '0001.webp', blob: new Blob(['one'], { type: 'image/webp' }), bytes: 3, width: 1, height: 1 }
  ], { imageBaseCid: root, name: 'No royalty collection', royaltyBps: 0 });
  const text = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
  assert.ok(text.includes('"seller_fee_basis_points": 0'));
});

test('artist metadata overrides reject duplicate edition numbers', () => {
  const pack = loadPack();
  assert.throws(() => pack.normaliseOverrides([{ id: 1 }, { id: 1 }]), /duplicate edition 1/i);
});
