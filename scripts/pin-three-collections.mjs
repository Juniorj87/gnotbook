#!/usr/bin/env node
/**
 * Pin the three Morrow collections to Octopin using two separate accounts.
 * Reads OCTOPIN_API_KEY_1 and OCTOPIN_API_KEY_2 from the local .env only.
 * Checks quotas first, trims editions evenly if necessary, uploads image and
 * metadata directories, fetches every file back from the gateway, then updates manifests.
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.octopin.app';
const UPLOAD = 'https://upload.octopin.app/api/upload';
const GATEWAY = `${String(process.env.OCTOPIN_GATEWAY || 'https://gateway.octopin.app/ipfs/').trim().replace(/\/+$/, '')}/`;
const rawKeys = [process.env.OCTOPIN_API_KEY_1, process.env.OCTOPIN_API_KEY_2, process.env.OCTOPIN_API_KEY].map(k => String(k || '').trim()).filter(Boolean);
const uniqueKeys = [...new Set(rawKeys)];
const ACCOUNTS = uniqueKeys.map((key, i) => ({ id: i + 1, key, usage: null }));
const COLLECTIONS = [
  { slug: 'owl-collection', name: 'OWL COLLECTION', symbol: 'OWL', max: 333 },
  { slug: 'neon-souls', name: 'NEON SOULS', symbol: 'NSOUL', max: 333 },
  { slug: 'the-trees', name: 'THE TREES', symbol: 'TREES', max: 333 },
];
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const pad = n => String(n).padStart(4, '0');
const sleep = ms => new Promise(r => setTimeout(r, ms));
function fail(s) { throw new Error(s); }
async function api(url, account, options = {}, label = 'Octopin request') {
  let last;
  for (let attempt = 1; attempt <= 5; attempt++) {
    let res;
    try { res = await fetch(url, { ...options, headers: { Authorization: `Bearer ${account.key}`, ...(options.headers || {}) }, signal: AbortSignal.timeout(options.timeoutMs || 120000) }); }
    catch (e) { last = e; if (attempt === 5) fail(`${label} failed after retries: ${e.message}`); await sleep(1200 * attempt); continue; }
    if ([429, 500, 502, 503, 504].includes(res.status) && attempt < 5) { await sleep(1500 * attempt); continue; }
    return res;
  }
  throw last;
}
async function accountInfo(a) {
  const r = await api(`${API}/api/me`, a, {}, `Account ${a.id} check`);
  if (!r.ok) fail(`Octopin account ${a.id} authentication failed (HTTP ${r.status}).`);
  const j = await r.json().catch(() => null);
  if (!j?.ok || !j?.data?.usage) fail(`Octopin account ${a.id} returned an unexpected usage response.`);
  a.usage = j.data.usage;
  console.log(`Account ${a.id}: ${a.usage.fileCount}/${a.usage.maxFiles} files; ${(a.usage.quotaBytes / 1048576).toFixed(0)} MiB quota.`);
  return a;
}
async function listFiles(dir, ext, count) {
  const out = [];
  for (let n = 1; n <= count; n++) {
    const name = `${pad(n)}.${ext}`;
    const buffer = await fs.readFile(path.join(dir, name));
    out.push({ name, buffer, sha256: sha256(buffer) });
  }
  return out;
}
function chooseAccount(accounts, need) {
  return accounts.filter(a => a.usage.maxFiles - a.usage.fileCount >= need).sort((a,b) => (b.usage.maxFiles-b.usage.fileCount) - (a.usage.maxFiles-a.usage.fileCount))[0] || null;
}
async function uploadDir(files, label, accounts) {
  const account = chooseAccount(accounts, files.length);
  if (!account) fail(`No Octopin account has ${files.length} free file slots for ${label}.`);
  const form = new FormData();
  form.append('paths', JSON.stringify(files.map(f => f.name)));
  for (const f of files) form.append('file', new Blob([f.buffer]), f.name);
  console.log(`${label}: uploading ${files.length} files through account ${account.id}...`);
  const r = await api(UPLOAD, account, { method: 'POST', body: form, timeoutMs: 1800000 }, `Upload ${label}`);
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok || !j?.data?.cid || !j.data.isDirectory) fail(`Octopin upload failed for ${label} (HTTP ${r.status}): ${j?.error?.message || 'unexpected response'}`);
  account.usage.fileCount += files.length;
  return { cid: j.data.cid, pinId: j.data.id, accountId: account.id };
}
async function verify(cid, files, label, validate) {
  console.log(`${label}: verifying ${files.length} files via gateway...`);
  let index = 0, done = 0, firstError = null;
  const workers = Array.from({ length: 5 }, async () => {
    while (!firstError) {
      const i = index++;
      if (i >= files.length) return;
      try {
        let res;
        for (let n = 1; n <= 6; n++) {
          res = await fetch(`${GATEWAY}${cid}/${encodeURIComponent(files[i].name)}`, { signal: AbortSignal.timeout(60000) });
          if (res.ok) break;
          if (res.status !== 404 && res.status !== 429 && res.status < 500) fail(`Gateway HTTP ${res.status} for ${files[i].name}`);
          if (n === 6) fail(`Gateway did not serve ${files[i].name} (HTTP ${res.status})`);
          await sleep(1200 * n);
        }
        const bytes = Buffer.from(await res.arrayBuffer());
        if (sha256(bytes) !== files[i].sha256) fail(`Checksum mismatch for ${files[i].name}`);
        if (validate) validate(bytes, files[i]);
        done++;
        if (done % 100 === 0 || done === files.length) console.log(`  ${done}/${files.length} verified`);
      } catch (e) { firstError = e; return; }
    }
  });
  await Promise.all(workers);
  if (firstError) fail(`${label}: ${firstError.message}`);
}
async function trimToSupply(c, supply) {
  const base = path.join(ROOT, 'collections', c.slug);
  for (const [kind, ext] of [['images','webp'], ['metadata','json']]) {
    const dir = path.join(base, kind);
    for (const name of await fs.readdir(dir)) {
      const m = name.match(/^(\d{4})\.(webp|json)$/);
      if (m && Number(m[1]) > supply) await fs.rm(path.join(dir, name));
    }
  }
  for (let i=1;i<=supply;i++) {
    const p=path.join(base,'metadata',`${pad(i)}.json`);
    const m=JSON.parse(await fs.readFile(p,'utf8'));
    m.name = `${c.name} #${pad(i)}`;
    m.description = `${c.name} digital collectible, edition #${pad(i)} of ${supply}. Ownership is represented by the deployed collection contract; no future value or utility is promised unless separately announced.`;
    m.image = `ipfs://PENDING_IMAGE_CID/${pad(i)}.webp`;
    m.properties = { ...(m.properties || {}), edition:i, max_supply:supply, mint_price_gnot:5, founder_reserve:false, mint_policy:'public-mint' };
    for (const a of m.attributes || []) if (a.trait_type === 'Edition') a.value = `${pad(i)} / ${supply}`;
    await fs.writeFile(p, JSON.stringify(m,null,2)+'\n');
  }
  const mp=path.join(base,'manifest.json');
  const manifest=JSON.parse(await fs.readFile(mp,'utf8'));
  manifest.supply=supply; manifest.images=supply; manifest.metadata_files=supply; manifest.mint_price_gnot=5; manifest.founder_reserve=0;
  manifest.ipfs_status='PENDING'; manifest.image_base_uri=''; manifest.metadata_base_uri=''; manifest.pin_provider='Octopin'; manifest.pinned_at=null;
  manifest.tokens=[];
  for (let i=1;i<=supply;i++) {
    const name=`${pad(i)}.webp`, bytes=await fs.readFile(path.join(base,'images',name));
    manifest.tokens.push({token_id:i,image_path:name,metadata_path:`${pad(i)}.json`,image_sha256:sha256(bytes)});
  }
  await fs.writeFile(mp,JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}
async function main() {
  if (!ACCOUNTS.length) fail('Set OCTOPIN_API_KEY (or OCTOPIN_API_KEY_1 / OCTOPIN_API_KEY_2) in local .env. Do not commit .env.');
  for (const a of ACCOUNTS) await accountInfo(a);
  const totalFree = ACCOUNTS.reduce((n,a)=>n + Math.max(0,a.usage.maxFiles-a.usage.fileCount),0);
  const editions = Math.min(999, Math.floor(totalFree/2));
  if (editions < 3) fail(`Only ${totalFree} total free file slots across both accounts; cannot publish even one edition in each of the three collections. No upload attempted.`);
  // Start with one edition per collection, then distribute remaining capacity evenly.
  const supplies = Object.fromEntries(COLLECTIONS.map(c=>[c.slug,1]));
  let remaining = editions - 3;
  while (remaining > 0) {
    let progressed = false;
    for (const c of COLLECTIONS) if (supplies[c.slug] < c.max && remaining > 0) { supplies[c.slug]++; remaining--; progressed=true; }
    if (!progressed) break;
  }
  console.log(`Edition allocation (capacity-safe): ${COLLECTIONS.map(c=>`${c.name} ${supplies[c.slug]}`).join(' · ')} = ${Object.values(supplies).reduce((a,b)=>a+b,0)} editions / ${Object.values(supplies).reduce((a,b)=>a+b,0)*2} files.`);
  const allManifests=[];
  for (const c of COLLECTIONS) {
    const supply=supplies[c.slug];
    const base=path.join(ROOT,'collections',c.slug);
    const manifest=await trimToSupply(c,supply);
    const images=await listFiles(path.join(base,'images'),'webp',supply);
    const imageUpload=await uploadDir(images,`${c.name} images`,ACCOUNTS);
    await verify(imageUpload.cid,images,`${c.name} images`);
    const metadata=[];
    for (let i=1;i<=supply;i++) {
      const name=`${pad(i)}.json`, p=path.join(base,'metadata',name);
      const m=JSON.parse(await fs.readFile(p,'utf8'));
      m.image=`ipfs://${imageUpload.cid}/${pad(i)}.webp`;
      await fs.writeFile(p,JSON.stringify(m,null,2)+'\n');
      const buffer=Buffer.from(JSON.stringify(m,null,2)+'\n');
      metadata.push({name,buffer,sha256:sha256(buffer)});
    }
    const metaUpload=await uploadDir(metadata,`${c.name} metadata`,ACCOUNTS);
    await verify(metaUpload.cid,metadata,`${c.name} metadata`,bytes=>{const m=JSON.parse(bytes.toString('utf8')); if (!String(m.image).startsWith(`ipfs://${imageUpload.cid}/`)) fail('Metadata image URI does not match the pinned image CID.');});
    manifest.ipfs_status='PINNED_VERIFIED'; manifest.image_base_uri=`ipfs://${imageUpload.cid}`; manifest.metadata_base_uri=`ipfs://${metaUpload.cid}`;
    manifest.image_pin={id:imageUpload.pinId,account:imageUpload.accountId}; manifest.metadata_pin={id:metaUpload.pinId,account:metaUpload.accountId}; manifest.pinned_at=new Date().toISOString();
    for (const t of manifest.tokens) { const b=await fs.readFile(path.join(base,'metadata',t.metadata_path)); t.metadata_sha256=sha256(b); }
    await fs.writeFile(path.join(base,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    allManifests.push({slug:c.slug,name:c.name,symbol:c.symbol,max_supply:supply,mint_price_gnot:5,mint_price_ugnot:5000000,founder_reserve:0,image_base_uri:manifest.image_base_uri,metadata_base_uri:manifest.metadata_base_uri,ipfs_status:'PINNED_VERIFIED',launch_status:'NOT_DEPLOYED',image_account:imageUpload.accountId,metadata_account:metaUpload.accountId});
    console.log(`${c.name}: VERIFIED · images ${imageUpload.cid} · metadata ${metaUpload.cid}`);
  }
  const dataPath=path.join(ROOT,'data','new-collections.json');
  const current=JSON.parse(await fs.readFile(dataPath,'utf8'));
  current.network='gno.land'; current.currency='GNOT'; current.mint_price_gnot=5; current.founder_reserve=0; current.collections=allManifests;
  await fs.writeFile(dataPath,JSON.stringify(current,null,2)+'\n');
  const summary={completed_at:new Date().toISOString(),provider:'Octopin',accounts:ACCOUNTS.map(a=>({account:a.id,fileCount:a.usage.fileCount,maxFiles:a.usage.maxFiles})),collections:allManifests};
  await fs.writeFile(path.join(ROOT,'data','octopin-three-collections.json'),JSON.stringify(summary,null,2)+'\n');
  console.log('\nALL THREE COLLECTIONS PINNED AND GATEWAY-CHECKSUM VERIFIED. Mainnet contract deployment remains a separate signed on-chain operation.');
}
main().catch(e=>{console.error(`Octopin collection upload failed: ${e.message}`);process.exitCode=1;});
