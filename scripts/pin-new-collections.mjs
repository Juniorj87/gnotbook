#!/usr/bin/env node
/**
 * Pin Owl Collection, NEON SOULS and THE TREES to Pinata.
 * Credentials are read from PINATA_JWT and never logged or written to files.
 * Each collection is pinned separately as an image directory and metadata directory.
 * Metadata is rewritten only after the image CID is returned; then the metadata directory is uploaded.
 * Run: node scripts/pin-new-collections.mjs --collection=owl-collection
 * Or:  node scripts/pin-new-collections.mjs --all
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = path.join(ROOT, 'collections');
const COLLECTIONS = {
  'owl-collection': { name: 'OWL COLLECTION', supply: 333 },
  'neon-souls': { name: 'NEON SOULS', supply: 333 },
  'the-trees': { name: 'THE TREES', supply: 333 },
};
const jwt = String(process.env.PINATA_JWT || '').trim();
const gateway = String(process.env.PINATA_GATEWAY || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
const arg = process.argv.find(x => x.startsWith('--collection='))?.split('=')[1];
const all = process.argv.includes('--all');
const selected = all ? Object.keys(COLLECTIONS) : [arg];
if (!jwt) throw new Error('PINATA_JWT is missing. Add it to local .env; never send it in chat or commit it.');
if (!all && (!arg || !COLLECTIONS[arg])) throw new Error(`Choose --collection=${Object.keys(COLLECTIONS).join(' | ')} or --all.`);
if (!gateway) console.warn('PINATA_GATEWAY is unset; CIDs will still be stored as ipfs:// URIs.');

async function uploadDirectory(slug, kind, files) {
  const form = new FormData();
  form.append('pinataMetadata', JSON.stringify({ name: `morrow-${slug}-${kind}` }));
  form.append('pinataOptions', JSON.stringify({ cidVersion: 1, wrapWithDirectory: true }));
  // Path-bearing filenames preserve each directory's numbered paths on Pinata.
  for (const f of files) form.append('file', new Blob([f.bytes], { type: f.type }), f.name);
  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body: form,
    signal: AbortSignal.timeout(30 * 60 * 1000),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Pinata upload failed for ${slug}/${kind}: HTTP ${res.status}; ${payload?.error || payload?.message || 'see Pinata dashboard'}`);
  const cid = payload?.IpfsHash || payload?.ipfsHash || payload?.data?.cid;
  if (!cid || !/^[A-Za-z0-9]{20,}$/.test(cid)) throw new Error(`Pinata did not return a valid directory CID for ${slug}/${kind}. Inspect response in Pinata dashboard.`);
  return cid;
}
async function readDir(dir, ext) {
  const names = (await fs.readdir(dir)).filter(n => new RegExp(`^\\d{4}\\.${ext}$`).test(n)).sort();
  return Promise.all(names.map(async name => ({ name, bytes: await fs.readFile(path.join(dir, name)), type: ext === 'webp' ? 'image/webp' : 'application/json' })));
}
for (const slug of selected) {
  const cfg = COLLECTIONS[slug]; const dir = path.join(BASE, slug);
  const images = await readDir(path.join(dir, 'images'), 'webp');
  const metadata = await readDir(path.join(dir, 'metadata'), 'json');
  if (images.length !== cfg.supply || metadata.length !== cfg.supply) throw new Error(`${slug}: expected ${cfg.supply} images and metadata files; found ${images.length}/${metadata.length}.`);
  const hashes = new Set(images.map(f => crypto.createHash('sha256').update(f.bytes).digest('hex')));
  if (hashes.size !== cfg.supply) throw new Error(`${slug}: duplicate image bytes detected.`);
  console.log(`${cfg.name}: uploading ${cfg.supply} images...`);
  const imageCid = await uploadDirectory(slug, 'images', images);
  // Rewrite local metadata with the real immutable image CID before metadata pinning.
  for (const file of metadata) {
    const m = JSON.parse(file.bytes.toString('utf8'));
    m.image = `ipfs://${imageCid}/${file.name.replace('.json', '.webp')}`;
    file.bytes = Buffer.from(`${JSON.stringify(m, null, 2)}\n`);
    await fs.writeFile(path.join(dir, 'metadata', file.name), file.bytes);
  }
  console.log(`${cfg.name}: uploading ${cfg.supply} metadata files...`);
  const metadataCid = await uploadDirectory(slug, 'metadata', metadata);
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.ipfs_status = 'PINNED_UNVERIFIED';
  manifest.image_base_uri = `ipfs://${imageCid}`;
  manifest.metadata_base_uri = `ipfs://${metadataCid}`;
  manifest.pin_provider = 'Pinata';
  manifest.pinned_at = new Date().toISOString();
  for (const t of manifest.tokens) { const b = await fs.readFile(path.join(dir, 'metadata', t.metadata_path)); t.metadata_sha256 = crypto.createHash('sha256').update(b).digest('hex'); }
  // Avoid claiming gateway verification: this records successful upload responses only.
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${cfg.name}: image CID ${imageCid}; metadata CID ${metadataCid}`);
  console.log(`Uploaded. Verify sample gateway URLs and all objects before changing status to PINNED_VERIFIED or deploying a realm.`);
}
