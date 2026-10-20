#!/usr/bin/env node
/**
 * Pin the GNO PUNK collection to Octopin and verify every object.
 *
 * Why 1,000 editions:
 *   Octopin Free allows 2,000 files. A 1,111-edition drop needs 2,222 files
 *   (one image + one JSON per edition). The published drop is therefore 1,000
 *   editions = exactly 2,000 files. Editions 1001-1111 live in
 *   nft-collection-archive/ and are never uploaded here.
 *
 * Uses the documented Octopin endpoints:
 *   POST https://upload.octopin.app/api/upload   (multipart `paths` + repeated `file`)
 *   GET  https://api.octopin.app/api/me          (plan + usage)
 *   GET  https://api.octopin.app/psa/pins        (resume / cleanup)
 *   DELETE https://api.octopin.app/psa/pins/:id  (remove a stale pin)
 *
 * Flags:
 *   --dry-run       validate files and print the exact file budget, upload nothing
 *   --verify-only   re-verify the CIDs from the saved state, upload nothing
 *
 * The API key is read only from OCTOPIN_API_KEY. It is never written to disk,
 * printed, or included in the manifest.
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCollection, SUPPLY } from './build-collection.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.join(ROOT, 'nft-collection');
const IMAGE_DIR = path.join(PACK, 'images');
const META_DIR = path.join(PACK, 'metadata');
const STATE_PATH = path.join(ROOT, 'data', 'octopin-state.json');
const MANIFEST_PATH = path.join(ROOT, 'data', 'collection-manifest.json');
const ENV_PATH = path.join(ROOT, '.env');
const API = 'https://api.octopin.app';
const UPLOAD = 'https://upload.octopin.app/api/upload';
const KEY = String(process.env.OCTOPIN_API_KEY || '').trim();
const GATEWAY = `${String(process.env.OCTOPIN_GATEWAY || 'https://gateway.octopin.app/ipfs/').trim().replace(/\/+$/, '')}/`;
const DRY_RUN = process.argv.includes('--dry-run');
const VERIFY_ONLY = process.argv.includes('--verify-only');
const VERIFY_CONCURRENCY = 5;

const pad = (value) => String(value).padStart(4, '0');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const gatewayUrl = (cid, name) => `${GATEWAY}${cid}/${encodeURIComponent(name)}`;

function fail(message) {
  throw new Error(message);
}

function assertKey() {
  if (!KEY) fail('OCTOPIN_API_KEY is not set. Put it in .env (server-side only) and rerun.');
}

async function request(url, options = {}, label = 'Octopin request') {
  const attempts = 5;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        ...options,
        headers: { Authorization: `Bearer ${KEY}`, ...(options.headers || {}) },
        signal: AbortSignal.timeout(options.timeoutMs || 120_000)
      });
    } catch (error) {
      if (attempt === attempts) fail(`${label} failed after ${attempts} attempts: ${error.message}`);
      await sleep(1500 * attempt);
      continue;
    }
    if (response.status === 401) fail(`${label}: Octopin rejected the API key (401). Check OCTOPIN_API_KEY.`);
    if (response.status === 402 || response.status === 403) {
      const body = await response.text().catch(() => '');
      fail(`${label}: the plan does not allow this operation (${response.status}). ${body.slice(0, 200)}`);
    }
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1200 * attempt;
      if (attempt === attempts) {
        const body = await response.text().catch(() => '');
        fail(`${label} failed with HTTP ${response.status}: ${body.slice(0, 240)}`);
      }
      console.log(`  ${label}: HTTP ${response.status}, retrying in ${Math.round(delay / 1000)}s (${attempt}/${attempts})`);
      await sleep(delay);
      continue;
    }
    return response;
  }
  fail(`${label} exhausted its retries.`);
}

async function account() {
  const response = await request(`${API}/api/me`, {}, 'Account check');
  if (!response.ok) fail(`Account check failed with HTTP ${response.status}.`);
  const payload = await response.json().catch(() => null);
  if (!payload?.ok || !payload?.data?.usage) fail('Octopin returned an unexpected account payload.');
  return payload.data;
}

async function listPins() {
  const response = await request(`${API}/psa/pins?limit=100`, {}, 'Pin list');
  if (!response.ok) fail(`Could not list pins (HTTP ${response.status}).`);
  const payload = await response.json().catch(() => null);
  return Array.isArray(payload?.results) ? payload.results : [];
}

async function deletePin(requestid) {
  const response = await request(`${API}/psa/pins/${encodeURIComponent(requestid)}`, { method: 'DELETE' }, 'Pin delete');
  if (![200, 202, 204].includes(response.status)) {
    const body = await response.text().catch(() => '');
    fail(`Could not remove stale pin ${requestid} (HTTP ${response.status}): ${body.slice(0, 160)}`);
  }
  console.log(`  Removed stale pin ${requestid}.`);
}

async function directoryFiles(dir, pattern) {
  const names = (await fs.readdir(dir)).filter((name) => pattern.test(name)).sort();
  const files = [];
  for (const name of names) {
    const buffer = await fs.readFile(path.join(dir, name));
    files.push({ name, buffer, sha256: sha256(buffer) });
  }
  return files;
}

async function verifyFile(cid, file) {
  const url = gatewayUrl(cid, file.name);
  let response;
  // A freshly pinned directory can need a few seconds to appear on the gateway.
  for (let attempt = 1; attempt <= 5; attempt++) {
    response = await request(url, { timeoutMs: 60_000 }, `Gateway GET ${file.name}`);
    if (response.ok) break;
    if (response.status !== 404 || attempt === 5) fail(`Gateway returned HTTP ${response.status} for ${file.name}.`);
    await sleep(1500 * attempt);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== file.sha256) fail(`Gateway content for ${file.name} does not match the local checksum.`);
  return bytes;
}

async function verifyDirectory(cid, files, label, extraCheck) {
  console.log(`Verifying ${files.length.toLocaleString()} ${label} through ${GATEWAY}${cid}/ ...`);
  let cursor = 0;
  let done = 0;
  let failed = null;
  const workers = Array.from({ length: VERIFY_CONCURRENCY }, async () => {
    while (!failed) {
      const index = cursor++;
      if (index >= files.length) return;
      try {
        const bytes = await verifyFile(cid, files[index]);
        if (extraCheck) await extraCheck(cid, files[index], bytes);
      } catch (error) {
        failed = error;
        return;
      }
      done += 1;
      if (done % 100 === 0 || done === files.length) console.log(`  ${done.toLocaleString()} / ${files.length.toLocaleString()} verified`);
    }
  });
  await Promise.all(workers);
  if (failed) fail(failed.message);
  console.log(`  ${label} directory ${cid} verified.`);
}

async function uploadDirectory(files, label) {
  console.log(`Uploading ${files.length.toLocaleString()} ${label} files (${(files.reduce((sum, file) => sum + file.buffer.length, 0) / (1024 * 1024)).toFixed(1)} MiB)...`);
  const form = new FormData();
  form.append('paths', JSON.stringify(files.map((file) => file.name)));
  for (const file of files) form.append('file', new Blob([file.buffer]), file.name);
  const response = await request(UPLOAD, {
    method: 'POST',
    body: form,
    timeoutMs: 30 * 60 * 1000
  }, `Upload ${label}`);
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok || !payload?.data?.cid) {
    const message = payload?.error?.message || JSON.stringify(payload || {}).slice(0, 200);
    fail(`Upload of ${label} failed (HTTP ${response.status}): ${message}`);
  }
  const { cid, id, isDirectory } = payload.data;
  if (!isDirectory) fail(`Octopin treated the ${label} upload as a single file; the folder structure was not preserved.`);
  console.log(`  ${label}: ${cid} (pin ${id})`);
  return { cid, pinId: id };
}

async function discoverPin(pins, kind, files) {
  // Recover from a lost state file: test each pinned directory against the
  // first file's checksum. This never trusts a CID without content evidence.
  const sample = files[0];
  for (const pin of pins) {
    const cid = pin?.pin?.cid;
    if (!cid || pin.status !== 'pinned') continue;
    try {
      const response = await fetch(gatewayUrl(cid, sample.name), { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (sha256(bytes) === sample.sha256) {
        console.log(`  Recovered ${kind} directory ${cid} from the existing pin list.`);
        return { cid, pinId: pin.requestid };
      }
    } catch {
      // Not this pin; try the next one.
    }
  }
  return null;
}

async function usageGuard(accountData, additionalFiles, label) {
  const { fileCount, maxFiles } = accountData.usage;
  const projected = fileCount + additionalFiles;
  console.log(`  Budget (${label}): ${fileCount.toLocaleString()} used + ${additionalFiles.toLocaleString()} new = ${projected.toLocaleString()} / ${maxFiles.toLocaleString()} files.`);
  if (projected > maxFiles) {
    fail(`Octopin plan limit would be exceeded: ${projected.toLocaleString()} files > ${maxFiles.toLocaleString()}. Nothing was uploaded. Upgrade the plan or reduce the collection; do not bypass the limit.`);
  }
}

async function readState() {
  try {
    return JSON.parse(await fs.readFile(STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

async function writeState(state) {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

function envLine(key, value) {
  return `${key}=${value}`;
}

async function updateEnv(values) {
  let text = '';
  try {
    text = await fs.readFile(ENV_PATH, 'utf8');
  } catch {
    text = '';
  }
  const lines = text.split(/\r?\n/);
  for (const [key, value] of Object.entries(values)) {
    const index = lines.findIndex((line) => line.trim().startsWith(`${key}=`));
    if (index >= 0) lines[index] = envLine(key, value);
    else lines.push(envLine(key, value));
  }
  while (lines.length && lines.at(-1) === '') lines.pop();
  await fs.writeFile(ENV_PATH, `${lines.join('\n')}\n`, { mode: 0o600 });
  console.log(`Updated ${Object.keys(values).join(', ')} in .env (no secrets written).`);
}

async function updateManifest({ imageCid, metadataCid, imagePinId, metadataPinId, accountData }) {
  let manifest = {};
  try {
    manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
  } catch {
    manifest = { collection: 'GNO PUNK', supply: SUPPLY };
  }
  manifest.image_base_uri = `ipfs://${imageCid}/`;
  manifest.metadata_base_uri = `ipfs://${metadataCid}/`;
  manifest.pinned = true;
  manifest.verified_at = new Date().toISOString();
  manifest.octopin = {
    image_cid: imageCid,
    metadata_cid: metadataCid,
    image_pin_id: imagePinId,
    metadata_pin_id: metadataPinId,
    file_count: SUPPLY * 2,
    plan_file_limit: accountData.usage.maxFiles,
    plan: accountData.plan?.id || 'free',
    gateway: GATEWAY
  };
  manifest.archive = {
    path: 'nft-collection-archive/editions-1001-1111.zip',
    editions: 111,
    note: 'Excluded from the published 1,000-edition drop to stay inside the 2,000-file plan limit.'
  };
  await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function metadataCheck(cid, file, bytes, imageBaseUri) {
  const id = file.name.replace(/\.json$/, '');
  let doc = null;
  try { doc = JSON.parse(bytes.toString('utf8')); } catch { doc = null; }
  if (!doc) fail(`Metadata ${file.name} is not valid JSON.`);
  if (doc.name !== `GNO PUNK #${id}`) fail(`Metadata ${file.name} has an unexpected name.`);
  if (Array.isArray(doc.attributes) === false) fail(`Metadata ${file.name} has no attributes array.`);
  const edition = doc.attributes.find((attr) => attr?.trait_type === 'Edition');
  if (!edition || edition.value !== `${id} / ${SUPPLY}`) fail(`Metadata ${file.name} has a mismatched edition.`);
  if (doc.image !== `${imageBaseUri}${id}.webp`) fail(`Metadata ${file.name} does not point at ${imageBaseUri}${id}.webp.`);
  if (doc.properties?.edition !== Number(id)) fail(`Metadata ${file.name} has a mismatched properties.edition.`);
}

async function main() {
  assertKey();
  console.log('Morrow · Octopin pinning');
  console.log('Collection: GNO PUNK · 1,000 editions · 2,000 files maximum');

  const accountData = await account();
  const { fileCount, maxFiles, quotaBytes, bytesUsed } = accountData.usage;
  console.log(`Plan: ${accountData.plan?.label || accountData.plan?.id || 'unknown'} · files ${fileCount.toLocaleString()}/${maxFiles.toLocaleString()} · storage ${(bytesUsed / (1024 * 1024)).toFixed(1)} MiB / ${(quotaBytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`);

  const images = await directoryFiles(IMAGE_DIR, /^\d{4}\.webp$/);
  const metadata = await directoryFiles(META_DIR, /^\d{4}\.json$/);
  if (images.length !== SUPPLY) fail(`Expected ${SUPPLY} images, found ${images.length}.`);
  if (metadata.length !== SUPPLY) fail(`Expected ${SUPPLY} metadata files, found ${metadata.length}.`);
  if (images.some((file, index) => file.name !== `${pad(index + 1)}.webp`)) fail('Image filenames are not contiguous 0001-1000.');
  if (metadata.some((file, index) => file.name !== `${pad(index + 1)}.json`)) fail('Metadata filenames are not contiguous 0001-1000.');
  console.log(`Local files validated: ${images.length.toLocaleString()} images + ${metadata.length.toLocaleString()} JSON.`);

  const state = await readState();
  const pins = await listPins();

  const reusableImages = state.imageCid ? { cid: state.imageCid, pinId: state.imagePinId } : await discoverPin(pins, 'image', images);
  const reusableMetadata = state.metadataCid ? { cid: state.metadataCid, pinId: state.metadataPinId } : await discoverPin(pins, 'metadata', metadata);

  if (DRY_RUN) {
    const needed = (reusableImages ? 0 : images.length) + (reusableMetadata ? 0 : metadata.length);
    usageGuard(accountData, needed, 'dry run');
    console.log('Dry run complete. No files uploaded.');
    return;
  }

  let imageCid = reusableImages?.cid || '';
  let imagePinId = reusableImages?.pinId || '';
  if (imageCid) {
    console.log(`Reusing image directory ${imageCid}; verifying before reuse.`);
    try {
      await verifyDirectory(imageCid, images, 'image');
    } catch (error) {
      console.log(`  Reuse failed (${error.message}); a fresh upload is required.`);
      if (imagePinId) await deletePin(imagePinId).catch(() => {});
      imageCid = '';
      imagePinId = '';
    }
  }

  if (!imageCid) {
    if (VERIFY_ONLY) fail('No verified image CID in the saved state. Run without --verify-only first.');
    usageGuard(accountData, images.length, 'images');
    const uploaded = await uploadDirectory(images, 'image');
    imageCid = uploaded.cid;
    imagePinId = uploaded.pinId;
    await verifyDirectory(imageCid, images, 'image');
    const afterUpload = await account();
    if (afterUpload.usage.fileCount !== fileCount + images.length) {
      console.log(`  Note: Octopin now reports ${afterUpload.usage.fileCount.toLocaleString()} files (deduplication or existing pins).`);
    }
    await writeState({ ...state, imageCid, imagePinId, imageVerifiedAt: new Date().toISOString(), supply: SUPPLY });
  }

  console.log('Rebuilding metadata with the verified image CID before pinning it.');
  await buildCollection({ imageCid, log: () => {} });
  const finalMetadata = await directoryFiles(META_DIR, /^\d{4}\.json$/);
  for (const file of finalMetadata) {
    const doc = JSON.parse(file.buffer.toString('utf8'));
    if (doc.image !== `ipfs://${imageCid}/${file.name.replace(/\.json$/, '.webp')}`) {
      fail(`Local metadata ${file.name} still does not point at the image CID.`);
    }
  }

  let metadataCid = (reusableMetadata?.cid && reusableMetadata.cid !== state.metadataCid) ? reusableMetadata.cid : (state.metadataCid || '');
  let metadataPinId = reusableMetadata?.pinId || state.metadataPinId || '';
  if (metadataCid) {
    console.log(`Reusing metadata directory ${metadataCid}; verifying before reuse.`);
    try {
      await verifyDirectory(metadataCid, finalMetadata, 'metadata', (cid, file, bytes) => metadataCheck(cid, file, bytes, `ipfs://${imageCid}/`));
    } catch (error) {
      console.log(`  Reuse failed (${error.message}); removing the stale metadata pin and re-uploading.`);
      if (metadataPinId) await deletePin(metadataPinId).catch(() => {});
      metadataCid = '';
      metadataPinId = '';
    }
  }

  if (!metadataCid) {
    if (VERIFY_ONLY) fail('No verified metadata CID in the saved state. Run without --verify-only first.');
    const latest = await account();
    usageGuard(latest, finalMetadata.length, 'metadata');
    const uploaded = await uploadDirectory(finalMetadata, 'metadata');
    metadataCid = uploaded.cid;
    metadataPinId = uploaded.pinId;
    await verifyDirectory(metadataCid, finalMetadata, 'metadata', (cid, file, bytes) => metadataCheck(cid, file, bytes, `ipfs://${imageCid}/`));
  }

  const finalAccount = await account();
  await writeState({
    supply: SUPPLY,
    imageCid,
    imagePinId,
    imageVerifiedAt: state.imageVerifiedAt || new Date().toISOString(),
    metadataCid,
    metadataPinId,
    metadataVerifiedAt: new Date().toISOString(),
    fileCount: finalAccount.usage.fileCount,
    maxFiles: finalAccount.usage.maxFiles
  });
  await updateManifest({ imageCid, metadataCid, imagePinId, metadataPinId, accountData: finalAccount });
  await updateEnv({
    MOONBOUND_IMAGE_BASE_URI: `ipfs://${imageCid}`,
    MOONBOUND_METADATA_BASE_URI: `ipfs://${metadataCid}`
  });

  console.log('');
  console.log('PIN COMPLETE — every object was fetched back from the gateway and checksum-verified.');
  console.log(`Image base:    ipfs://${imageCid}/`);
  console.log(`Metadata base: ipfs://${metadataCid}/`);
  console.log(`Files counted: ${finalAccount.usage.fileCount.toLocaleString()} / ${finalAccount.usage.maxFiles.toLocaleString()}`);
  console.log('Next: restart the server, run npm test, then verify the item page metadata link.');
}

main().catch((error) => {
  console.error(`Pin failed: ${error.message}`);
  process.exit(1);
});
