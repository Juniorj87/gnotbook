import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 4173);
const CHAIN_ID = process.env.GNOLAND_CHAIN_ID || 'gnoland-1';
const RPC_URL = (process.env.GNOLAND_RPC_URL || 'https://rpc.gno.land:443').replace(/\/$/, '');
const REGISTRY_PATH = cleanPkgPath(process.env.MORROW_REGISTRY_PATH || '');
// Public address only. The default is Morrow's published treasury so a fresh clone works without extra setup.
const TREASURY = String(process.env.MORROW_TREASURY_ADDRESS || 'g1u5mxwvz9hueavyjx2kpz88427rl6vgrkyu6328').trim();
const FOUNDER_ADDRESS = String(process.env.MORROW_FOUNDER_ADDRESS || '').trim();
// Founder reserve is minted at Init to the explicitly configured founder wallet for network gas only.
const FOUNDER_RESERVE = intEnv('MORROW_FOUNDER_RESERVE', 333, 0, 333);
const MARKETPLACE_FEE_BPS = intEnv('MARKETPLACE_FEE_BPS', 250, 250, 250);
const COLLECTION_SERVICE_FEE_UGNOT = 5_000_000; // Fixed in the registry contract: 5 GNOT.
const MAINNET_TX_ENABLED = /^(1|true|yes)$/i.test(process.env.GNOLAND_MAINNET_TRADING_ENABLED || 'false');
const ONYX_TX_ENABLED = /^(1|true|yes)$/i.test(process.env.GNOLAND_ONYX_TRADING_ENABLED || 'false');
const PINATA_JWT = String(process.env.PINATA_JWT || '').trim();
const PINATA_GATEWAY = normalizeGateway(process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud/ipfs/');
const OCTOPIN_API_KEY = String(process.env.OCTOPIN_API_KEY || '').trim();
const OCTOPIN_GATEWAY = normalizeGateway(process.env.OCTOPIN_GATEWAY || 'https://gateway.octopin.app/ipfs/');
const MAX_UPLOAD_MB = intEnv('MAX_UPLOAD_MB', 15, 1, 40);
const MAX_UPLOADS_PER_DAY = intEnv('MAX_UPLOADS_PER_DAY', 100, 1, 10000);
const MOONBOUND_IMAGE_BASE_URI = cleanIpfsBase(process.env.MOONBOUND_IMAGE_BASE_URI || '');
const MOONBOUND_METADATA_BASE_URI = cleanIpfsBase(process.env.MOONBOUND_METADATA_BASE_URI || '');
const MOONBOUND_COLLECTION_PATH = cleanPkgPath(process.env.MOONBOUND_COLLECTION_PATH || '');
const MOONBOUND_MINT_PRICE_UGNOT = 5_000_000;
const MOONBOUND_MAX_SUPPLY = 1000;
const PUBLIC_URL = String(process.env.MORROW_PUBLIC_URL || 'https://gno.land/').trim();
const SOCIAL_X = /^https:\/\/[^\s]+$/i.test(String(process.env.MORROW_X_URL || '').trim()) ? String(process.env.MORROW_X_URL).trim() : 'https://x.com/gnoland';
const SOCIAL_GITHUB = /^https:\/\/[^\s]+$/i.test(String(process.env.MORROW_GITHUB_URL || '').trim()) ? String(process.env.MORROW_GITHUB_URL).trim() : 'https://github.com/gnolang/gno';
const ADMIN_TOKEN = String(process.env.MORROW_ADMIN_TOKEN || '');
const verifiedPaths = new Set((process.env.VERIFIED_COLLECTION_PATHS || '').split(',').map(cleanPkgPath).filter(Boolean));
const STORE_PATH = process.env.MORROW_STORE_PATH
  ? path.resolve(process.env.MORROW_STORE_PATH) // test isolation: unit tests write to a scratch store
  : path.join(ROOT, 'data', 'store.json');
const STORE_LOCK = { chain: Promise.resolve() };
const uploadCounter = { day: new Date().toISOString().slice(0, 10), count: 0 };
let pgPool = null;

function intEnv(name, fallback, min, max) {
  const n = Number(process.env[name]);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : fallback;
}
function normalizeGateway(value) {
  let out = String(value || '').trim();
  if (!out) return 'https://gateway.pinata.cloud/ipfs/';
  if (!/^https:\/\//i.test(out)) throw new Error('IPFS gateway URLs must use HTTPS.');
  if (!out.endsWith('/')) out += '/';
  return out;
}
function cleanPkgPath(value) {
  const out = String(value || '').trim().replace(/^https?:\/\/[^/]+\//i, '').replace(/^\/+/, '').replace(/\$source.*$/, '');
  if (!out || out.length > 256) return '';
  if (!/^gno\.land\/r\/[a-z0-9]+(?:\/[a-z0-9_-]+)+$/i.test(out)) return '';
  const finalName = out.split('/').at(-1);
  return /^[a-z][a-z0-9_-]+$/.test(finalName) ? out : '';
}
function cleanIpfsBase(value) {
  const out = String(value || '').trim().replace(/\/$/, '');
  return /^ipfs:\/\/[a-zA-Z0-9]+(?:\/[a-zA-Z0-9._/-]+)?$/.test(out) ? out : '';
}
function safeAddress(value) { return /^g1[a-z0-9]{20,80}$/i.test(String(value || '').trim()); }
function isMainnet() { return CHAIN_ID === 'gnoland-1'; }
function json(res, status, data) { return res.status(status).json(data); }
function safeEq(a, b) {
  const aa = Buffer.from(String(a || '')); const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function decodeBase64(s) {
  if (!s) return Buffer.alloc(0);
  try { return Buffer.from(s, 'base64'); } catch { return Buffer.alloc(0); }
}
function decodeAmino(typed) {
  if (typed == null) return null;
  if (Array.isArray(typed)) return typed.map(decodeAmino);
  if (typeof typed !== 'object') return typed;
  if (typed.V && typeof typed.V === 'object') {
    const v = typed.V;
    if (Object.hasOwn(v, 'value')) {
      const raw = v.value;
      if (v['@type'] === '/gno.StringValue') return raw;
      if (v['@type'] === '/gno.BoolValue') return raw === true || raw === 'true';
      if (typeof raw === 'string' && /^-?\d+$/.test(raw)) {
        const n = Number(raw); return Number.isSafeInteger(n) ? n : raw;
      }
      return raw;
    }
    if (v['@type'] === '/gno.RefValue') return { objectId: v.ObjectID };
  }
  if (typeof typed.N === 'string') {
    const b = decodeBase64(typed.N);
    if (b.length === 8) {
      const raw = b.readBigInt64LE(0); const n = Number(raw);
      return Number.isSafeInteger(n) ? n : raw.toString();
    }
  }
  if (typed['@type'] === '/gno.StringValue' && Object.hasOwn(typed, 'value')) return typed.value;
  if (Object.hasOwn(typed, 'value') && typeof typed.value !== 'object') return typed.value;
  return typed;
}
async function rpc(method, params = {}, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${RPC_URL}/`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: `${Date.now()}`, method, params }), signal: controller.signal
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(`Gno RPC HTTP ${resp.status}`);
    if (data.error) throw new Error(data.error.message || `Gno RPC ${method} failed`);
    return data.result;
  } finally { clearTimeout(timer); }
}
async function abciQuery(queryPath, data = '', timeoutMs = 9000) {
  const params = { path: queryPath };
  if (data !== '') params.data = Buffer.from(String(data)).toString('base64');
  const result = await rpc('abci_query', params, timeoutMs);
  const base = result?.response?.ResponseBase;
  if (!base) throw new Error('Unexpected Gno RPC query response.');
  if (base.Error) throw new Error(typeof base.Error === 'string' ? base.Error : (base.Error.message || JSON.stringify(base.Error)));
  return { raw: result, data: decodeBase64(base.Data).toString('utf8'), height: result?.response?.Height || null };
}
async function evalValues(pkg, func, args = [], timeoutMs = 9000) {
  const clean = cleanPkgPath(pkg);
  if (!clean || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(func))) throw new Error('Invalid Gno realm query.');
  const exprArgs = args.map((arg) => {
    if (typeof arg === 'number' || typeof arg === 'bigint') return String(arg);
    if (typeof arg === 'boolean') return String(arg);
    const v = String(arg);
    if (v.startsWith('address(') && v.endsWith(')')) return v;
    if (v.startsWith('"') && v.endsWith('"')) return v;
    if (/^-?\d+$/.test(v)) return v;
    return JSON.stringify(v);
  });
  const expr = `${clean}.${func}(${exprArgs.join(',')})`;
  const out = await abciQuery('vm/qeval_json', expr, timeoutMs);
  let parsed;
  try { parsed = JSON.parse(out.data); } catch { throw new Error('Gno returned invalid structured data.'); }
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.results)) parsed = parsed.results;
  if (!Array.isArray(parsed)) return [decodeAmino(parsed)];
  return parsed.map(decodeAmino);
}
async function evalValue(pkg, func, args = [], timeoutMs = 9000) {
  const values = await evalValues(pkg, func, args, timeoutMs);
  return values.length === 1 ? values[0] : values;
}
// A single-value qeval_json response keeps Gno's {"results":[...]} envelope; unwrap and decode it.
function unwrapResults(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.results) ? value.results : value;
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map(decodeAmino);
}
async function realmRead(pkg, func) { return unwrapResults(await evalValue(pkg, func))[0]; }
// External Gno.land projects surfaced in the market. Every number is read from the realm itself,
// never estimated, and no listing is shown for a realm Morrow cannot custody.
const EXTERNAL_PROJECTS = [
  {
    slug: 'guardians',
    name: 'Guardians',
    realm: 'gno.land/r/g1nmqhha0ua730vejxqhrelldm4pga5j5ptle5ea/guardians',
    site: 'https://guardians.family/',
    twitter: 'https://x.com/_GuardiansNFT',
    description: 'An independent Gno.land collection managed by its creators. Official mint availability, price and eligibility are controlled by the Guardians team.'
  }
];
let externalProjectsCache = { at: 0, value: null };
async function readExternalProjects() {
  if (externalProjectsCache.value && Date.now() - externalProjectsCache.at < 60_000) return externalProjectsCache.value;
  const value = await Promise.all(EXTERNAL_PROJECTS.map(async (p) => {
    const explorer = `https://gno.land/${p.realm.replace(/^gno\.land\//, '')}`;
    try {
      const [name, symbol, minted, maxSupply] = await Promise.all([
        realmRead(p.realm, 'Name').catch(() => ''), realmRead(p.realm, 'Symbol').catch(() => ''),
        realmRead(p.realm, 'TotalSupply').catch(() => null), realmRead(p.realm, 'MaxSupply').catch(() => null)
      ]);
      const mintedN = minted === null ? null : num(minted, -1);
      const maxN = maxSupply === null ? null : num(maxSupply, -1);
      if (mintedN === null || mintedN < 0 || maxN === null || maxN < 1) return { ...p, explorer, onchain: null };
      return { ...p, explorer, onchain: { name: cleanText(name, 64), symbol: cleanText(symbol, 16), minted: mintedN, maxSupply: maxN } };
    } catch { return { ...p, explorer, onchain: null }; }
  }));
  externalProjectsCache = { at: Date.now(), value };
  return value;
}
function parseRecordLines(value) {
  if (Array.isArray(value)) value = value[0];
  if (value == null) return [];
  return String(value).split(/\r?\n/).filter(Boolean).map((line) => line.split('|'));
}
function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function cleanText(v, max = 300) { return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max); }
function ipfsUrl(uri) {
  const v = String(uri || '');
  if (v.startsWith('ipfs://')) return `${OCTOPIN_GATEWAY}${v.slice(7).replace(/^ipfs\//, '')}`;
  return /^https:\/\//i.test(v) ? v : '';
}
function toCollectionPath(v) { return cleanPkgPath(v); }
const WHITELIST_MAX_ADDRESSES = 10_000;
const WHITELIST_MAX_BYTES = 128 * 1024;
// Parses TXT/CSV/JSON allowlist files. Accepts bare addresses, one per line, CSV cells
// (first column wins per row), or JSON arrays of strings/objects with an address field.
function parseWhitelistText(raw) {
  const text = typeof raw === 'string' ? raw : '';
  if (!text.trim()) return { valid: [], invalid: [], error: 'The allowlist file is empty.' };
  if (Buffer.byteLength(text, 'utf8') > WHITELIST_MAX_BYTES) return { valid: [], invalid: [], error: 'The allowlist file is too large (128 kB limit).' };
  let candidates = [];
  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed.addresses) ? parsed.addresses : (typeof parsed === 'object' && parsed !== null ? [parsed] : []);
      for (const row of rows) {
        const v = typeof row === 'string' ? row.trim() : cleanText(row?.address || row?.wallet || row?.addr || row?.value, 100);
        if (v) candidates.push(v);
      }
    } catch (e) { return { valid: [], invalid: [], error: `The file is not valid JSON: ${cleanText(e.message, 120)}` }; }
  } else {
    for (const line of text.split(/\r?\n/)) {
      const first = line.split(',')[0]?.trim() ?? line.trim();
      const v = String(first || line.trim()).trim();
      if (v) candidates.push(v);
      if (candidates.length > WHITELIST_MAX_ADDRESSES + 100) break;
    }
  }
  const valid = [];
  const seen = new Set();
  const invalid = [];
  for (let i = 0; i < candidates.length; i++) {
    const address = candidates[i];
    if (seen.has(address.toLowerCase())) continue;
    if (!safeAddress(address)) { invalid.push({ line: i + 1, value: cleanText(address, 48), reason: 'Not a valid g1 wallet address.' }); if (invalid.length > 50) break; continue; }
    seen.add(address.toLowerCase());
    valid.push(address.toLowerCase());
    if (valid.length >= WHITELIST_MAX_ADDRESSES) { invalid.push({ line: 0, value: '', reason: `Stopped at ${WHITELIST_MAX_ADDRESSES} unique addresses; split large lists.` }); break; }
  }
  return { valid, invalid, error: '' };
}
function slugOf(pkgPath) { return String(pkgPath || '').split('/').filter(Boolean).at(-1) || ''; }
function normalizeRegistryRow(row) {
  if (!row || row.length < 2) return null;
  // Registry rows: slug|path|name|symbol|cover|maxSupply|minted|mintPrice|royaltyBps|imageBaseURI|metadataBaseURI|creator
  const [slug, rawPath, name, symbol, cover, maxSupply, minted, mintPriceUgnot, royaltyBps, imageBaseURI, metadataBaseURI, creator] = row;
  const pathValue = toCollectionPath(rawPath);
  if (!pathValue || !name) return null;
  return {
    slug: cleanText(slug || slugOf(pathValue), 32), path: pathValue,
    name: cleanText(name, 64), symbol: cleanText(symbol, 12),
    image: ipfsUrl(cover) || cover || '', cover: cover || '',
    maxSupply: num(maxSupply), minted: num(minted), mintPriceUgnot: num(mintPriceUgnot),
    royaltyBps: num(royaltyBps), imageBaseURI: cleanIpfsBase(imageBaseURI || ''), metadataBaseURI: cleanIpfsBase(metadataBaseURI || ''),
    assetBaseURI: cleanIpfsBase(imageBaseURI || ''), creator: cleanText(creator, 100), verified: verifiedPaths.has(pathValue), external: false,
    description: '', onchain: true
  };
}
async function readCollection(pathValue) {
  const cPath = toCollectionPath(pathValue);
  if (!cPath) throw new Error('Invalid collection path.');
  const [name, symbol, creator, cover, maxSupply, minted, mintPrice, royaltyBps, imageBaseURI, metadataBaseURI, marketplaceFeeBps, marketplaceFeeSink] = await Promise.all([
    evalValue(cPath, 'Name').catch(() => ''), evalValue(cPath, 'Symbol').catch(() => ''),
    evalValue(cPath, 'Creator').catch(() => ''), evalValue(cPath, 'Cover').catch(() => ''),
    evalValue(cPath, 'MaxSupply').catch(() => 0), evalValue(cPath, 'Minted').catch(() => 0),
    evalValue(cPath, 'MintPrice').catch(() => 0), evalValue(cPath, 'RoyaltyBps').catch(() => 0),
    evalValue(cPath, 'ImageBaseURI').catch(() => evalValue(cPath, 'AssetBaseURI').catch(() => '')),
    evalValue(cPath, 'MetadataBaseURI').catch(() => ''), evalValue(cPath, 'MarketplaceFeeBps').catch(() => 0),
    evalValue(cPath, 'MarketplaceFeeSink').catch(() => '')
  ]);
  const feeSink = cleanText(marketplaceFeeSink, 100);
  const feeSinkMatchesTreasury = !safeAddress(TREASURY) || feeSink.toLowerCase() === TREASURY.toLowerCase();
  const protocolBps = num(marketplaceFeeBps);
  return {
    path: cPath, slug: slugOf(cPath), name: cleanText(name, 64) || slugOf(cPath), symbol: cleanText(symbol, 12),
    creator: cleanText(creator, 100), image: ipfsUrl(cover) || cover || '', cover: cover || '',
    maxSupply: num(maxSupply), minted: num(minted), mintPriceUgnot: num(mintPrice), royaltyBps: num(royaltyBps),
    imageBaseURI: cleanIpfsBase(imageBaseURI || ''), metadataBaseURI: cleanIpfsBase(metadataBaseURI || ''),
    assetBaseURI: cleanIpfsBase(imageBaseURI || ''), protocolBps, marketplaceFeeSink: feeSink,
    feeEnforced: protocolBps === 250 && safeAddress(feeSink) && feeSinkMatchesTreasury,
    verified: verifiedPaths.has(cPath), external: false, onchain: true
  };
}
// The public catalog starts empty: demos were retired. Collections appear here only after
// a user saves one through /api/collections/create or the on-chain registry reports one.
const DEFAULT_COLLECTIONS = [];

async function getCollections() {
  let onchainColls = [];
  let warning = '';
  let featuredCollectionPath = '';
  const persisted = await readStore().catch(() => ({ verifiedPaths: [], customCollections: [] }));
  const activeVerified = new Set([...verifiedPaths, ...(persisted.verifiedPaths || [])].map(toCollectionPath).filter(Boolean));
  if (REGISTRY_PATH) {
    try {
      const rowsValue = await evalValue(REGISTRY_PATH, 'ListCollections').catch((e) => { throw new Error(`Morrow registry query failed: ${e.message}`); });
      const paths = parseRecordLines(rowsValue).map(normalizeRegistryRow).filter(Boolean);
      onchainColls = await Promise.all(paths.map(async (c) => {
        try {
          const dynamic = await readCollection(c.path);
          return { ...c, ...dynamic, verified: activeVerified.has(c.path) };
        } catch { return { ...c, verified: activeVerified.has(c.path) }; }
      }));
      const featuredRaw = await evalValue(REGISTRY_PATH, 'FeaturedCollection').catch(() => '');
      featuredCollectionPath = toCollectionPath(featuredRaw);
    } catch (e) {
      warning = cleanText(e.message, 200);
    }
  }
  const mergedMap = new Map();
  for (const c of DEFAULT_COLLECTIONS) mergedMap.set(c.slug, { ...c });
  for (const c of (persisted.customCollections || [])) mergedMap.set(c.slug, { ...(mergedMap.get(c.slug) || {}), ...c });
  for (const c of onchainColls) mergedMap.set(c.slug, { ...(mergedMap.get(c.slug) || {}), ...c });
  const collections = [...mergedMap.values()].map((c) => {
    const wl = (persisted.whitelists || {})[c.slug];
    return { ...c, allowlistCount: wl ? wl.count : 0, allowlistPrepared: !!wl,
      featured: featuredCollectionPath ? c.path === featuredCollectionPath : (c.featured || c.slug === 'moonbound') };
  });
  return { collections, warning, featuredCollectionPath, whitelists: persisted.whitelists || {} };
}
function parseOpenItems(value, collection) {
  return parseRecordLines(value).map((fields) => {
    // ItemLine: id|name|owner|seller|price|listed|image|slug|rarity|traits|onchain|reserved
    if (fields.length < 8) return null;
    const [id, name, owner, seller, price, listed, image, , rarity, traits] = fields;
    return {
      id: cleanText(id, 32), name: cleanText(name, 100), owner: cleanText(owner, 100), seller: cleanText(seller, 100),
      priceUgnot: num(price), listed: String(listed) === 'true', image: ipfsUrl(image) || image || collection.image,
      collectionName: collection.name, collectionPath: collection.path, rarity: cleanText(rarity, 32), traits: cleanText(traits, 500),
      verified: !!collection.verified, creator: collection.creator, royaltyBps: collection.royaltyBps,
      protocolBps: num(collection.protocolBps), feeEnforced: !!collection.feeEnforced, marketplaceFeeSink: collection.marketplaceFeeSink || '',
      preview: false, description: ''
    };
  }).filter((item) => item && item.listed);
}
async function getMarket() {
  const { collections, warning, featuredCollectionPath = '' } = await getCollections();
  const listingSets = await Promise.all(collections.map(async (c) => {
    try {
      const raw = await evalValue(c.path, 'ListOpen').catch(() => '');
      return parseOpenItems(raw, c);
    } catch { return []; }
  }));
  return { ok: true, collections, listings: listingSets.flat().sort((a, b) => b.id - a.id), warning, registryPath: REGISTRY_PATH, featuredCollectionPath };
}
// The bank/balances endpoint answers with a bare "<amount><denom>" string on the
// current public RPC (e.g. "283868ugnot"). Older nodes answered with an object.
// Both shapes are normalised here so a real balance is never reported as zero.
function parseBalances(raw) {
  let parsed = null;
  try { parsed = JSON.parse(raw || 'null'); } catch { parsed = null; }
  const list = Array.isArray(parsed?.balances) ? parsed.balances
    : Array.isArray(parsed) ? parsed
      : Array.isArray(parsed?.coins) ? parsed.coins
        : null;
  if (list) {
    return list.map((b) => ({ denom: cleanText(b?.denom, 100), amount: String(b?.amount ?? '0') }))
      .filter((b) => b.denom && b.amount);
  }
  if (typeof parsed === 'string') {
    const m = parsed.trim().match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z][a-zA-Z0-9/_-]*)$/);
    if (m) return [{ denom: m[2], amount: m[1] }];
    return [];
  }
  if (parsed && typeof parsed === 'object') {
    // map form: { "ugnot": "283868" }
    return Object.entries(parsed)
      .filter(([denom, amount]) => typeof amount === 'string' || typeof amount === 'number')
      .map(([denom, amount]) => ({ denom: cleanText(denom, 100), amount: String(amount) }));
  }
  return [];
}
async function readBalances(address) {
  if (!safeAddress(address)) throw new Error('Invalid Gno address.');
  const result = await abciQuery(`bank/balances/${address}`);
  return parseBalances(result.data || '{}');
}
// Neon and other managed Postgres hand out a pooled URL with `channel_binding=require`,
// which node-postgres cannot negotiate. Strip it and force TLS instead of failing later.
function pgConnectionOptions() {
  const raw = String(process.env.DATABASE_URL || '');
  let connectionString = raw;
  let ssl;
  try {
    const url = new URL(raw);
    url.searchParams.delete('channel_binding');
    const sslMode = String(url.searchParams.get('sslmode') || '').toLowerCase();
    const wantsSsl = ['require', 'prefer', 'verify-ca', 'verify-full'].includes(sslMode)
      || ['1', 'true', 'yes'].includes(String(process.env.PGSSL || '').toLowerCase());
    connectionString = url.toString();
    if (wantsSsl) ssl = { rejectUnauthorized: false };
  } catch {
    ssl = /^(true|1)$/i.test(process.env.PGSSL || 'false') ? { rejectUnauthorized: false } : undefined;
  }
  return { connectionString, ssl };
}
async function readStore() {
  if (process.env.DATABASE_URL) {
    try {
      if (!pgPool) {
        const { Pool } = await import('pg');
        pgPool = new Pool({ ...pgConnectionOptions(), max: 5, idleTimeoutMillis: 10000, connectionTimeoutMillis: 5000 });
        await pgPool.query('CREATE TABLE IF NOT EXISTS morrow_store (id integer PRIMARY KEY CHECK (id=1), data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())');
        await pgPool.query('INSERT INTO morrow_store (id,data) VALUES (1,$1) ON CONFLICT (id) DO NOTHING', [JSON.stringify(emptyStore())]);
      }
      const result = await pgPool.query('SELECT data FROM morrow_store WHERE id=1');
      return normalizeStore(result.rows[0]?.data);
    } catch (e) { console.error('Postgres store unavailable; local JSON fallback is active:', e.message); }
  }
  try { return normalizeStore(JSON.parse(await fs.readFile(STORE_PATH, 'utf8'))); }
  catch { return emptyStore(); }
}
function emptyStore() { return { points: {}, rewards: [], reports: [], uploads: [], verifiedPaths: [...verifiedPaths], customCollections: [], whitelists: {} }; }
function normalizeStore(s) { const d = s && typeof s === 'object' ? s : {}; return { points: d.points && typeof d.points === 'object' ? d.points : {}, rewards: Array.isArray(d.rewards) ? d.rewards : [], reports: Array.isArray(d.reports) ? d.reports : [], uploads: Array.isArray(d.uploads) ? d.uploads : [], verifiedPaths: Array.isArray(d.verifiedPaths) ? d.verifiedPaths : [...verifiedPaths], customCollections: Array.isArray(d.customCollections) ? d.customCollections : [], whitelists: d.whitelists && typeof d.whitelists === 'object' && !Array.isArray(d.whitelists) ? d.whitelists : {} }; }
async function writeStore(store) {
  const normalized = normalizeStore(store);
  if (process.env.DATABASE_URL) {
    try {
      if (!pgPool) await readStore();
      if (pgPool) { await pgPool.query('INSERT INTO morrow_store (id,data,updated_at) VALUES (1,$1,now()) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data,updated_at=now()', [JSON.stringify(normalized)]); return; }
    } catch (e) { console.error('Postgres write failed; writing local JSON fallback:', e.message); }
  }
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(normalized, null, 2), { mode: 0o600 });
    await fs.rename(tmp, STORE_PATH);
  } catch (e) {
    // Serverless deployments have a read-only filesystem. Say so instead of leaking ENOFS.
    if (['EROFS', 'EACCES', 'ENOSPC'].includes(e.code)) {
      throw new Error('This deployment has no writable store. Set DATABASE_URL (Postgres) to persist collections, or run the app on a host with a writable disk.');
    }
    throw e;
  }
}
async function mutateStore(mutator) {
  let resolve;
  const prev = STORE_LOCK.chain;
  STORE_LOCK.chain = new Promise((r) => { resolve = r; });
  await prev;
  try { const store = await readStore(); const result = await mutator(store); await writeStore(store); return result; }
  finally { resolve(); }
}
function adminAuth(req, res, next) {
  if (!ADMIN_TOKEN || !safeEq(req.get('authorization')?.replace(/^Bearer\s+/i, ''), ADMIN_TOKEN)) return json(res, 401, { ok: false, error: 'Admin authorization required.' });
  next();
}
function validTxHash(v) { return /^[A-Fa-f0-9]{64}$/.test(String(v || '').replace(/^0x/, '')) || /^[A-Za-z0-9+/]{43}=$/.test(String(v || '')); }
function hashForRpc(value) {
  const h = String(value || '').replace(/^0x/i, '');
  if (/^[A-Fa-f0-9]{64}$/.test(h)) return Buffer.from(h, 'hex').toString('base64');
  return h;
}
function flattenEvents(events) {
  const out = [];
  for (const event of events || []) {
    const rawAttrs = Array.isArray(event.attributes) ? event.attributes : Array.isArray(event.attrs) ? event.attrs : [];
    const attrs = Object.fromEntries(rawAttrs.map((a) => [String(a.key || ''), String(a.value || '')]));
    out.push({ type: String(event.type || ''), ...attrs, raw: JSON.stringify(attrs) });
  }
  return out;
}
async function verifyConfirmedAction(address, txHash) {
  if (!safeAddress(address)) throw new Error('Invalid wallet address.');
  if (!validTxHash(txHash)) throw new Error('Enter a valid 32-byte transaction hash.');
  if (!REGISTRY_PATH) throw new Error('Morrow registry is not configured; chain rewards are unavailable.');
  const { collections } = await getCollections();
  const registeredPaths = new Set(collections.map((c) => c.path));
  if (!registeredPaths.size) throw new Error('No Morrow-registered collection realms are available for reward verification.');
  const tx = await rpc('tx', { hash: hashForRpc(txHash) }, 12000);
  const height = num(tx?.height, 0);
  const result = tx?.tx_result || {};
  if (height <= 0 || num(result.code, 0) !== 0) throw new Error('Transaction is not confirmed successfully yet.');
  const events = flattenEvents(result.events || []);
  const supported = new Set(['Mint', 'PublicMint', 'Buy', 'List', 'Cancel', 'Init']);
  const related = events.find((event) => {
    if (!supported.has(String(event.type || ''))) return false;
    const pkg = toCollectionPath(event.pkg || event.package || event.package_path || '');
    if (!pkg || !registeredPaths.has(pkg)) return false;
    return ['owner', 'buyer', 'seller', 'creator'].some((field) => String(event[field] || '').toLowerCase() === address.toLowerCase());
  });
  if (!related) throw new Error('This confirmed transaction has no supported event for the supplied wallet from a Morrow-registered collection.');
  const type = String(related.type || '');
  const label = type === 'Buy' ? 'Purchase' : type === 'List' ? 'Listing' : type === 'Cancel' ? 'Listing cancellation' : type === 'Init' ? 'Collection launch' : 'Mint';
  const awarded = type === 'Buy' ? 10 : type === 'List' ? 5 : type === 'Init' ? 15 : type === 'Cancel' ? 2 : 8;
  return { height, label, awarded, events: [related] };
}

app.disable('x-powered-by');
// "1", "true" and "yes" all mean one proxy hop. Behind a CDN (Vercel) the client
// address arrives in X-Forwarded-For, and a rate limiter without trust proxy
// throws instead of limiting.
const TRUST_PROXY = ['1', 'true', 'yes'].includes(String(process.env.TRUST_PROXY || '').toLowerCase());
app.set('trust proxy', TRUST_PROXY ? 1 : false);
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], baseUri: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"],
    scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'], imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'ipfs:'],
    connectSrc: ["'self'", 'https://rpc.gno.land', 'https://rpc.onyx.testnets.gno.land', 'https://uploads.pinata.cloud', 'https://api.pinata.cloud'],
    formAction: ["'self'"], upgradeInsecureRequests: []
  } }
}));
app.use(express.json({ limit: '1mb', strict: true }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
// A rate limiter must never be the reason an API call fails: if the client
// address cannot be determined, fall back to the socket address.
function clientKey(req) {
  try { return req.ip || req.socket?.remoteAddress || 'unknown'; }
  catch { return 'unknown'; }
}
const generalLimiter = rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: clientKey });
const writeLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: clientKey });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 }, fileFilter: (_req, file, cb) => {
  const allowed = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  if (!allowed.has(file.mimetype)) return cb(new Error('Only PNG, JPEG, WEBP and GIF images are accepted. SVG and HTML uploads are disabled.'));
  cb(null, true);
} });
app.use('/api/', generalLimiter);
app.get('/admin', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'admin.html')));
app.use(express.static(path.join(ROOT, 'public'), { index: 'index.html', maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0, etag: true }));
app.use('/collection-assets', express.static(path.join(ROOT, 'nft-collection'), { fallthrough: false, maxAge: '1h', index: false }));
app.use('/collections', express.static(path.join(ROOT, 'collections'), { fallthrough: false, maxAge: '1h', index: false }));

app.get('/favicon.ico', (_req, res) => res.status(204).end());
app.get('/healthz', (_req, res) => res.json({ ok: true, uptimeSeconds: Math.floor(process.uptime()), chainId: CHAIN_ID }));
app.get(['/api/health', '/api/healthz'], async (_req, res) => {
  let rpcHealthy = false;
  let latestHeight = null;
  try {
    const status = await rpc('status', {}, 2500);
    rpcHealthy = !!status?.sync_info;
    latestHeight = status?.sync_info?.latest_block_height || null;
  } catch {}
  res.json({
    ok: true,
    uptimeSeconds: Math.floor(process.uptime()),
    chainId: CHAIN_ID,
    rpcHealthy,
    latestHeight,
    persistenceMode: process.env.DATABASE_URL ? 'postgres' : 'file-store',
  });
});
app.get('/api/config', async (_req, res) => {
  let rpcHealthy = false; let latestHeight = null; let rpcError = '';
  try { const status = await rpc('status', {}, 4000); rpcHealthy = !!status?.sync_info; latestHeight = status?.sync_info?.latest_block_height || null; }
  catch (e) { rpcError = cleanText(e.message, 180); }
  const collectionsRead = await getCollections();
  const registeredCollections = collectionsRead.collections;
  const featuredCollectionPath = collectionsRead.featuredCollectionPath || '';
  const moonboundRegistered = registeredCollections.find((c) => c.slug === 'moonbound') || null;
  const defaultMoonboundPath = DEFAULT_COLLECTIONS.find((c) => c.slug === 'moonbound')?.path || 'gno.land/r/morrow/moonbound';
  const moonboundPath = moonboundRegistered?.path || MOONBOUND_COLLECTION_PATH || defaultMoonboundPath;
  const imageBaseURI = moonboundRegistered?.imageBaseURI || MOONBOUND_IMAGE_BASE_URI || '';
  const metadataBaseURI = moonboundRegistered?.metadataBaseURI || MOONBOUND_METADATA_BASE_URI || '';
  const assetsConfigured = !!imageBaseURI && !!metadataBaseURI;
  const registryConfigured = !!REGISTRY_PATH;
  const networkWritesEnabled = isMainnet() ? MAINNET_TX_ENABLED : (CHAIN_ID === 'onyx-1' ? ONYX_TX_ENABLED : false);
  const registryFeeSink = registryConfigured ? cleanText(await evalValue(REGISTRY_PATH, 'FeeSink').catch(() => ''), 100) : '';
  const registryAdmin = registryConfigured ? cleanText(await evalValue(REGISTRY_PATH, 'Admin').catch(() => ''), 100) : '';
  const moonboundMintsPerWallet = moonboundRegistered ? num(await evalValue(moonboundPath, 'PublicMintLimit').catch(() => 0)) : 0;
  const registryLaunchFeeRaw = registryConfigured ? await evalValue(REGISTRY_PATH, 'LaunchFee').catch(() => null) : null;
  const registryProtocolBpsRaw = registryConfigured ? await evalValue(REGISTRY_PATH, 'MarketplaceFeeBps').catch(() => null) : null;
  const registryLaunchFee = registryLaunchFeeRaw === null ? null : num(registryLaunchFeeRaw, -1);
  const registryProtocolBps = registryProtocolBpsRaw === null ? null : num(registryProtocolBpsRaw, -1);
  const registryTreasuryMatches = safeAddress(TREASURY) && safeAddress(registryFeeSink) && registryFeeSink.toLowerCase() === TREASURY.toLowerCase();
  const registryFeeModelMatches = registryLaunchFee === COLLECTION_SERVICE_FEE_UGNOT && registryProtocolBps === 250;
  const registryCompatible = registryConfigured && registryTreasuryMatches && registryFeeModelMatches;
  const bootstrapEnabled = networkWritesEnabled && safeAddress(TREASURY);
  const transactionsEnabled = networkWritesEnabled;
  const registryError = !networkWritesEnabled ? `Write operations are disabled for ${CHAIN_ID}; enable the appropriate network flag.` : '';
  const moonboundLaunchEnabled = transactionsEnabled && !moonboundRegistered && !!MOONBOUND_IMAGE_BASE_URI && !!MOONBOUND_METADATA_BASE_URI;
  const onchainLaunchFee = registryLaunchFee ?? COLLECTION_SERVICE_FEE_UGNOT;
  res.json({
    ok: true, product: 'Morrow Marketplace', chainId: CHAIN_ID, rpcUrl: RPC_URL, registryPath: REGISTRY_PATH, featuredCollectionPath,
    treasuryConfigured: safeAddress(TREASURY), treasuryAddress: safeAddress(TREASURY) ? TREASURY : '',
    marketplaceFeeBps: MARKETPLACE_FEE_BPS, collectionServiceFeeUgnot: onchainLaunchFee, launchFeeGnot: onchainLaunchFee / 1_000_000,
    tradingEnabled: transactionsEnabled, transactionsEnabled, bootstrapEnabled, registryCompatible, registryFeeModelMatches, registryTreasuryMatches,
    adminWallet: safeAddress(registryAdmin) ? registryAdmin : '',
    mainnetTransfersAdminEnabled: MAINNET_TX_ENABLED, onyxTransactionsAdminEnabled: ONYX_TX_ENABLED,
    socials: { x: SOCIAL_X, github: SOCIAL_GITHUB },
    pinningConfigured: !!(PINATA_JWT || OCTOPIN_API_KEY), pinataGateway: PINATA_GATEWAY,
    octopinConfigured: !!OCTOPIN_API_KEY, collectionGateway: OCTOPIN_GATEWAY,
    rpcHealthy, latestHeight, rpcError, maxUploadMB: MAX_UPLOAD_MB,
    collections: registeredCollections,
    moonbound: {
      name: 'GNO PUNK', symbol: 'GNP', maxSupply: MOONBOUND_MAX_SUPPLY,
      mintPriceUgnot: MOONBOUND_MINT_PRICE_UGNOT, imageBaseUri: imageBaseURI, metadataBaseUri: metadataBaseURI,
      assetsConfigured, collectionPath: moonboundPath, collectionConfigured: !!(moonboundRegistered || MOONBOUND_COLLECTION_PATH || defaultMoonboundPath),
      minted: moonboundRegistered?.minted || 0, launchEnabled: moonboundLaunchEnabled,
      mintsPerWallet: moonboundMintsPerWallet,
      mintEnabled: transactionsEnabled,
      externalPath: moonboundPath ? `https://gno.land/${moonboundPath.replace(/^gno\.land\//, '')}` : '',
      imageGateway: MOONBOUND_IMAGE_BASE_URI.startsWith('ipfs://') ? `${OCTOPIN_GATEWAY}${MOONBOUND_IMAGE_BASE_URI.slice('ipfs://'.length)}` : '',
      metadataGateway: MOONBOUND_METADATA_BASE_URI.startsWith('ipfs://') ? `${OCTOPIN_GATEWAY}${MOONBOUND_METADATA_BASE_URI.slice('ipfs://'.length)}` : '',
      founderAddress: safeAddress(FOUNDER_ADDRESS) ? FOUNDER_ADDRESS : (safeAddress(TREASURY) ? TREASURY : ''),
      founderReserve: FOUNDER_RESERVE
    },
    points: { buy: 10, list: 5, mint: 8, launch: 15, cancel: 2 },
    projects: await readExternalProjects(),
    registryConfigured, registryError
  });
});
app.get('/api/market', async (_req, res) => {
  try { res.json(await getMarket()); }
  catch (e) { res.json({ ok: false, collections: [], listings: [], warning: cleanText(e.message, 300), registryPath: REGISTRY_PATH }); }
});
app.get('/api/collection-items', async (req, res) => {
  try {
    const pkg = toCollectionPath(req.query.pkg);
    const offset = Math.max(0, Math.min(1_000_000, Number.parseInt(String(req.query.offset || '0'), 10) || 0));
    const limit = Math.max(1, Math.min(48, Number.parseInt(String(req.query.limit || '24'), 10) || 24));
    if (!pkg) return json(res, 400, { ok: false, error: 'Valid collection realm path is required.' });
    const { collections } = await getCollections();
    const collection = collections.find((c) => c.path === pkg || c.slug === slugOf(pkg));
    if (!collection) return json(res, 404, { ok: false, error: 'That realm is not registered in Morrow.' });
    if (collection.slug === 'guardians') {
      const total = collection.maxSupply || 1024;
      const sliceCount = Math.min(limit, Math.max(0, total - offset));
      const guardianEditions = [];
      for (let i = 0; i < sliceCount; i++) {
        const id = offset + i + 1;
        guardianEditions.push({
          id: String(id),
          name: `Guardians — Unrevealed #${id}`,
          owner: collection.creator || 'g1nmqhha0ua730vejxqhrelldm4pga5j5ptle5ea',
          seller: '',
          priceUgnot: 0,
          listed: false,
          image: 'https://guardians-genesis-assets.moonsu0706.workers.dev/release/6e6cda0e2e9de25b/veiled/UNREVEALED_1024.png',
          collectionName: 'GUARDIANS',
          collectionPath: collection.path,
          rarity: 'Genesis',
          traits: 'Reveal Status:Unrevealed',
          verified: true,
          creator: collection.creator,
          royaltyBps: 500,
          preview: false,
          description: 'A Guardian remains sealed in the veil. Traits and identity will be revealed after the collection reveal.'
        });
      }
      return res.json({ ok: true, items: guardianEditions, total, offset, limit, hasMore: offset + sliceCount < total });
    }
    const maxId = Math.max(0, num(await evalValue(pkg, 'NextID').catch(() => collection.minted)));
    const startId = maxId - offset;
    if (startId < 1) {
      const slug = collection.slug;
      let dir = path.join(ROOT, 'collections', slug, 'metadata');
      if (slug === 'moonbound') dir = path.join(ROOT, 'nft-collection', 'metadata');
      const files = (await fs.readdir(dir).catch(() => [])).filter(f => /^\d{4}\.json$/.test(f)).sort();
      const slice = files.slice(offset, offset + limit);
      const localEditions = [];
      for (const f of slice) {
        try {
          const doc = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
          const id = f.replace(/\.json$/, '');
          const img = slug === 'moonbound'
            ? (MOONBOUND_IMAGE_BASE_URI.startsWith('ipfs://') ? `${OCTOPIN_GATEWAY}${MOONBOUND_IMAGE_BASE_URI.slice(7).replace(/\/$/, '')}/${id}.webp` : `/collection-assets/images/${id}.webp`)
            : `/collections/${slug}/images/${id}.webp`;
          const traits = (doc.attributes || []).map(a => `${a.trait_type}:${a.value}`).join(';');
          localEditions.push({
            id: String(Number(id)),
            name: doc.name || `${collection.name} #${id}`,
            owner: collection.creator || '',
            seller: '',
            priceUgnot: collection.mintPriceUgnot || 5000000,
            listed: false,
            image: img,
            collectionName: collection.name,
            collectionPath: collection.path,
            rarity: doc.attributes?.find(a => a.trait_type === 'Rarity')?.value || 'Common',
            traits,
            verified: true,
            creator: collection.creator,
            royaltyBps: collection.royaltyBps,
            preview: true,
            description: doc.description || ''
          });
        } catch {}
      }
      return res.json({ ok: true, items: localEditions, total: files.length || collection.maxSupply, offset, limit, hasMore: offset + slice.length < (files.length || collection.maxSupply) });
    }
    const raw = await evalValue(pkg, 'ItemLines', [startId, limit]).catch(async () => {
      const lines = [];
      for (let id = startId; id >= Math.max(1, startId - limit + 1); id--) {
        const line = await evalValue(pkg, 'ItemLine', [id]).catch(() => '');
        if (line) lines.push(String(line));
      }
      return lines.join('\n');
    });
    const items = parseRecordLines(raw).map((fields) => {
      if (fields.length < 8) return null;
      const [id, name, owner, seller, price, listed, image, , rarity, traits] = fields;
      return { id: cleanText(id, 32), name: cleanText(name, 100), owner: cleanText(owner, 100), seller: cleanText(seller, 100),
        priceUgnot: num(price), listed: String(listed) === 'true', image: ipfsUrl(image) || image || collection.image,
        collectionName: collection.name, collectionPath: collection.path, rarity: cleanText(rarity, 32), traits: cleanText(traits, 500),
        verified: !!collection.verified, creator: collection.creator, royaltyBps: collection.royaltyBps,
        protocolBps: num(collection.protocolBps), feeEnforced: !!collection.feeEnforced, marketplaceFeeSink: collection.marketplaceFeeSink || '',
        preview: false, description: '' };
    }).filter(Boolean);
    res.json({ ok: true, items, total: maxId, offset, limit, hasMore: offset + items.length < maxId });
  } catch (e) { json(res, 502, { ok: false, error: cleanText(e.message, 240) }); }
});
const traitCaches = new Map();
async function aggregateTraits(slug = 'moonbound') {
  const cleanSlug = String(slug || 'moonbound').toLowerCase();
  if (traitCaches.has(cleanSlug)) return traitCaches.get(cleanSlug);
  if (cleanSlug === 'guardians') {
    const res = {
      total: 1024,
      groups: [{ trait_type: 'Reveal Status', values: [{ value: 'Unrevealed', count: 1024 }] }],
      editions: {}
    };
    traitCaches.set(cleanSlug, res);
    return res;
  }
  let dir = path.join(ROOT, 'nft-collection', 'metadata');
  if (cleanSlug === 'neon-souls' || cleanSlug === 'the-trees' || cleanSlug === 'owl-collection') {
    dir = path.join(ROOT, 'collections', cleanSlug, 'metadata');
  }
  const files = (await fs.readdir(dir).catch(() => [])).filter((f) => /^\d{4}\.json$/.test(f)).sort();
  const groups = new Map();
  const editions = {};
  for (const file of files) {
    let doc = null;
    try { doc = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8')); } catch { continue; }
    const edition = file.replace(/\.json$/, '');
    const traits = {};
    for (const attr of Array.isArray(doc?.attributes) ? doc.attributes : []) {
      const traitType = cleanText(attr?.trait_type, 60); const value = cleanText(attr?.value, 80);
      if (!traitType || !value) continue;
      traits[traitType] = value;
      if (!groups.has(traitType)) groups.set(traitType, new Map());
      const bucket = groups.get(traitType);
      bucket.set(value, (bucket.get(value) || 0) + 1);
    }
    editions[edition] = traits;
  }
  const result = {
    total: files.length,
    groups: [...groups].map(([trait_type, values]) => ({ trait_type, values: [...values].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count) })),
    editions
  };
  traitCaches.set(cleanSlug, result);
  return result;
}
app.get('/api/traits', async (req, res) => {
  const slug = cleanText(String(req.query.collection || 'moonbound'), 32).toLowerCase();
  const allowed = new Set(['moonbound', 'neon-souls', 'the-trees', 'owl-collection', 'guardians']);
  if (!allowed.has(slug)) return json(res, 404, { ok: false, error: 'Trait aggregates are bundled for registered Morrow collections only.' });
  try {
    const data = await aggregateTraits(slug);
    res.json({ ok: true, collection: slug, ...data });
  } catch (e) { json(res, 502, { ok: false, error: cleanText(e.message, 200) }); }
});
app.post('/api/collections/create', writeLimiter, async (req, res) => {
  try {
    const name = cleanText(req.body?.name, 64);
    const symbol = cleanText(req.body?.symbol, 11).toUpperCase();
    const slug = cleanText(req.body?.slug, 32).toLowerCase();
    const pkg = toCollectionPath(req.body?.path || '');
    const image = cleanText(req.body?.image, 500);
    const maxSupply = Math.max(1, Math.min(1_000_000, Number(req.body?.maxSupply) || 1000));
    const mintPriceUgnot = Math.max(0, Number(req.body?.mintPriceUgnot) || 5_000_000);
    const royaltyBps = Math.max(0, Math.min(1000, Number(req.body?.royaltyBps) || 250));
    const creator = cleanText(req.body?.creator, 100);
    const description = cleanText(req.body?.description, 1000);
    const txHash = cleanText(req.body?.txHash, 100);
    const mintType = String(req.body?.mintType || 'paid').toLowerCase() === 'free' ? 'free' : 'paid';
    const website = cleanText(req.body?.website, 300);
    if (website && !/^https?:\/\/\S+$/i.test(website)) return json(res, 400, { ok: false, error: 'Website link must start with http:// or https://.' });
    const mintStartAtRaw = cleanText(req.body?.mintStartAt, 40);
    let mintStartAt = '';
    if (mintStartAtRaw) {
      const d = new Date(mintStartAtRaw);
      if (Number.isNaN(d.getTime())) return json(res, 400, { ok: false, error: 'Mint start date/time could not be parsed.' });
      if (d.getTime() < Date.now() - 60_000) return json(res, 400, { ok: false, error: 'Mint start must not be in the past (allow one minute adjustment).' });
      mintStartAt = d.toISOString();
    }
    if (!name || !symbol || !slug) return json(res, 400, { ok: false, error: 'Name, symbol and slug are required.' });
    // Whitelist: server-side parse of TXT/CSV/JSON text, validation and de-duplication.
    // Addresses are stored separately from the public collection record and never returned.
    let whitelistResult = null;
    if (typeof req.body?.whitelistText === 'string' && req.body.whitelistText.trim()) {
      whitelistResult = parseWhitelistText(req.body.whitelistText);
      if (whitelistResult.error) return json(res, 400, { ok: false, error: whitelistResult.error });
      if (!whitelistResult.valid.length) return json(res, 400, { ok: false, error: 'The allowlist contains no valid addresses.' });
    }
    const newColl = {
      slug, path: pkg || `gno.land/r/${creator || 'creator'}/${slug}`,
      name, symbol, image: image,
      cover: image,
      maxSupply, minted: 0, mintPriceUgnot: mintType === 'free' ? 0 : mintPriceUgnot, royaltyBps,
      creator: creator || TREASURY, verified: false, external: false,
      description: description || 'Community minted collection on Gnotbook.',
      featured: true, mintEnabled: true, badge: 'Community Drop', onchain: true, txHash,
      mintStartAt, mintType, website,
      launchStatus: txHash ? 'PUBLISHED' : 'DRAFT'
    };
    let whitelistSummary = null;
    await mutateStore((store) => {
      store.customCollections = store.customCollections || [];
      const idx = store.customCollections.findIndex(c => c.slug === slug || c.path === newColl.path);
      if (idx >= 0) store.customCollections[idx] = { ...store.customCollections[idx], ...newColl };
      else store.customCollections.unshift(newColl);
      if (store.customCollections.length > 50) store.customCollections = store.customCollections.slice(0, 50);
      if (whitelistResult) {
        store.whitelists = store.whitelists || {};
        store.whitelists[slug] = { count: whitelistResult.valid.length, addresses: whitelistResult.valid, preparedAt: new Date().toISOString() };
        whitelistSummary = { count: whitelistResult.valid.length, invalid: whitelistResult.invalid };
      } else if (store.whitelists?.[slug] && mintType === 'free') {
        whitelistSummary = { count: store.whitelists[slug].count, invalid: [] };
      }
    });
    res.json({ ok: true, collection: newColl, whitelist: whitelistSummary });
  } catch (e) {
    console.error('Collection create failed:', e && e.message ? e.message : e);
    json(res, 500, { ok: false, error: cleanText(e.message, 200) });
  }
});
// Machine-readable pinning record produced by scripts/pin-octopin.mjs.
// It never contains API keys; it only exposes verified CIDs, counts and checksums.
app.get('/api/collection-manifest', async (_req, res) => {
  try {
    const raw = await fs.readFile(path.join(ROOT, 'data', 'collection-manifest.json'), 'utf8');
    const manifest = JSON.parse(raw);
    res.json({
      ok: true,
      collection: manifest.collection,
      supply: manifest.supply,
      founderReserve: manifest.founder_reserve,
      schema: manifest.schema,
      pinned: !!manifest.pinned,
      imageBaseUri: manifest.image_base_uri || '',
      metadataBaseUri: manifest.metadata_base_uri || '',
      builtAt: manifest.built_at || '',
      tokenCount: Array.isArray(manifest.tokens) ? manifest.tokens.length : 0
    });
  } catch (e) {
    json(res, e.code === 'ENOENT' ? 404 : 500, { ok: false, error: 'Collection manifest is not available yet.' });
  }
});
app.get('/api/realm-read', async (req, res) => {
  try {
    const pkg = toCollectionPath(req.query.pkg); const func = String(req.query.func || '');
    const args = Array.isArray(req.query.arg) ? req.query.arg : req.query.arg == null ? [] : [req.query.arg];
    const allowedFuncs = new Set(['Name', 'Symbol', 'Creator', 'Cover', 'MaxSupply', 'Minted', 'MintPrice', 'RoyaltyBps', 'ImageBaseURI', 'AssetBaseURI', 'MetadataBaseURI', 'MarketplaceFeeBps', 'MarketplaceFeeSink', 'NextID', 'ItemLines', 'ItemLine', 'ListOpen', 'TokensOf', 'OwnerOf', 'PublicMintLimit', 'MintsByWallet']);
    if (!pkg || pkg.length > 180 || !allowedFuncs.has(func) || args.length > 8) return json(res, 400, { ok: false, error: 'Invalid realm query.' });
    // Only registered Morrow collections may be read through this endpoint. Arbitrary realm
    // calls are not exposed, so a caller cannot use Morrow as a proxy into unrelated realms.
    const { collections } = await getCollections();
    if (!collections.some((c) => c.path === pkg)) return json(res, 404, { ok: false, error: 'That realm is not registered in Morrow.' });
    const value = await evalValue(pkg, func, args);
    res.json({ ok: true, value });
  } catch (e) { json(res, 502, { ok: false, error: cleanText(e.message, 240) }); }
});
app.get('/api/wallet/:address/balances', async (req, res) => {
  try { const balances = await readBalances(req.params.address); res.json({ ok: true, balances, warning: '' }); }
  catch (e) { res.json({ ok: true, balances: [], warning: cleanText(e.message, 220) }); }
});
async function getTokensForAddress(collection, address) {
  const pkg = collection.path;
  const items = [];
  // Skip un-deployed local templates to prevent RPC query timeouts
  if (pkg.startsWith('gno.land/r/morrow/') && !REGISTRY_PATH && pkg !== MOONBOUND_COLLECTION_PATH) {
    return items;
  }
  try {
    let balRaw = await evalValue(pkg, 'BalanceOf', [address], 3500).catch(() => null);
    if (balRaw == null) {
      balRaw = await evalValue(pkg, 'BalanceOf', [`address("${address}")`], 2000).catch(() => null);
    }
    const bal = Number(balRaw || 0);
    if (bal > 0) {
      const maxTokens = Math.min(bal, 50);
      for (let i = 0; i < maxTokens; i++) {
        let tidRaw = await evalValue(pkg, 'TokenOfOwnerByIndex', [address, i], 3500).catch(() => null);
        if (tidRaw == null) tidRaw = await evalValue(pkg, 'TokenOfOwnerByIndex', [`address("${address}")`, i], 2000).catch(() => null);
        if (tidRaw == null) continue;
        const tokenId = String(tidRaw);
        // The realm's TokenURI takes the id as a string. Passing a bare 314 would be
        // evaluated as a number literal and the realm would answer with nothing.
        const tokenIdArg = `"${tokenId.replace(/[^\w.-]/g, '')}"`;
        let tokenUri = await evalValue(pkg, 'TokenURI', [tokenIdArg], 3500).catch(() => null);
        if (tokenUri == null) tokenUri = await evalValue(pkg, 'TokenURI', [tokenId], 2000).catch(() => null);
        let name = `${collection.name} #${tokenId}`;
        let image = collection.image || '';
        let description = collection.description || '';
        let attributes = [];
        if (tokenUri && typeof tokenUri === 'string') {
          const resolvedUri = ipfsUrl(tokenUri) || tokenUri;
          if (resolvedUri.startsWith('http://') || resolvedUri.startsWith('https://')) {
            try {
              const metaRes = await fetch(resolvedUri, { signal: AbortSignal.timeout(3500) });
              if (metaRes.ok) {
                const meta = await metaRes.json();
                if (meta.name) name = cleanText(meta.name, 100);
                if (meta.image) image = ipfsUrl(meta.image) || meta.image;
                if (meta.description) description = cleanText(meta.description, 500);
                if (Array.isArray(meta.attributes)) attributes = meta.attributes;
              }
            } catch {}
          }
        }
        items.push({
          id: tokenId,
          name,
          image: ipfsUrl(image) || image || collection.image,
          description,
          owner: address,
          priceUgnot: 0,
          listed: false,
          collectionName: collection.name,
          collectionPath: pkg,
          verified: !!collection.verified,
          royaltyBps: collection.royaltyBps || 250,
          preview: false,
          attributes
        });
      }
      if (items.length > 0) return items;
    }
  } catch {}
  try {
    const idsValue = await evalValue(pkg, 'TokensOf', [address], 3000).catch(() => '');
    const ids = String(idsValue || '').split(',').filter((v) => /^\d+$/.test(v)).slice(0, 50);
    if (ids.length) {
      const details = await Promise.all(ids.map(async (id) => {
        const [name, img, owner, price, listed] = await Promise.all([
          evalValue(pkg, 'NameOf', [id], 3000).catch(() => ''),
          evalValue(pkg, 'ImageOf', [id], 3000).catch(() => ''),
          evalValue(pkg, 'GrcOwnerOf', [id], 3000).catch(() => address),
          evalValue(pkg, 'PriceOf', [id], 3000).catch(() => 0),
          evalValue(pkg, 'Listed', [id], 3000).catch(() => false)
        ]);
        return {
          id,
          name: cleanText(name, 100) || `${collection.name} #${id}`,
          image: ipfsUrl(img) || img || collection.image,
          owner: owner || address,
          priceUgnot: num(price),
          listed: listed === true || String(listed) === 'true',
          collectionName: collection.name,
          collectionPath: pkg,
          verified: collection.verified,
          royaltyBps: collection.royaltyBps,
          preview: false
        };
      }));
      items.push(...details.filter((t) => t.name));
    }
  } catch {}
  return items;
}

app.get('/api/portfolio/:address', async (req, res) => {
  const address = String(req.params.address || '');
  if (!safeAddress(address)) return json(res, 400, { ok: false, error: 'Invalid Gno address.' });
  try {
    const { collections } = await getCollections();
    const customRealm = toCollectionPath(req.query.customRealm || '');
    const scanList = [...collections];
    // Realms this server knows about but that are not (yet) in the public catalog:
    // the pinned collection and the external projects it surfaces in the market.
    // Without them a wallet that only holds those NFTs would look empty.
    const knownRealms = [
      { slug: 'moonbound', path: MOONBOUND_COLLECTION_PATH || 'gno.land/r/morrow/moonbound', name: 'GNO PUNK', verified: true, royaltyBps: 250 },
      ...EXTERNAL_PROJECTS.map((p) => ({ slug: p.slug, path: p.realm, name: p.name, verified: true, royaltyBps: 250 }))
    ];
    for (const known of knownRealms) {
      if (known.path && !scanList.some((c) => c.path === known.path)) scanList.push(known);
    }
    if (customRealm && !scanList.some((c) => c.path === customRealm)) {
      scanList.push({
        slug: slugOf(customRealm) || 'custom',
        path: customRealm,
        name: customRealm.split('/').pop()?.toUpperCase() || 'CUSTOM REALM',
        verified: false,
        royaltyBps: 250
      });
    }
    const tokens = []; const ownedCollections = [];
    const scanned = await Promise.all(scanList.slice(0, 40).map(async (collection) => {
      try {
        const items = await getTokensForAddress(collection, address);
        return { collection, items };
      } catch {
        return { collection, items: [] };
      }
    }));
    for (const { collection, items } of scanned) {
      if (items.length) {
        ownedCollections.push(collection);
        tokens.push(...items);
      }
    }
    res.json({ ok: true, collections: ownedCollections, tokens });
  } catch (e) { res.json({ ok: true, collections: [], tokens: [], warning: cleanText(e.message, 240) }); }
});
app.get('/api/points/:address', async (req, res) => {
  const address = String(req.params.address || '');
  if (!safeAddress(address)) return json(res, 400, { ok: false, error: 'Invalid Gno address.' });
  const store = await readStore(); const events = store.rewards.filter((r) => r.address.toLowerCase() === address.toLowerCase());
  res.json({ ok: true, total: events.reduce((n, r) => n + num(r.points), 0), events: events.slice(-100).reverse() });
});
app.post('/api/rewards/verify', writeLimiter, async (req, res) => {
  try {
    const address = String(req.body?.address || ''); const txHash = String(req.body?.txHash || '').trim();
    const checked = await verifyConfirmedAction(address, txHash);
    const normalizedHash = txHash.replace(/^0x/i, '').toUpperCase();
    const outcome = await mutateStore((store) => {
      if (store.rewards.some((r) => r.txHash === normalizedHash)) return { awarded: 0, duplicate: true, total: store.rewards.filter((r) => r.address.toLowerCase() === address.toLowerCase()).reduce((n, r) => n + num(r.points), 0) };
      const entry = { txHash: normalizedHash, address, label: checked.label, points: checked.awarded, height: checked.height, time: new Date().toISOString() };
      store.rewards.push(entry); store.points[address] = num(store.points[address]) + checked.awarded;
      return { awarded: checked.awarded, label: checked.label, total: store.points[address], height: checked.height };
    });
    res.json({ ok: true, ...outcome });
  } catch (e) { json(res, 422, { ok: false, error: cleanText(e.message, 240) }); }
});
app.post('/api/report', writeLimiter, async (req, res) => {
  const realm = cleanText(req.body?.realm, 180); const reason = cleanText(req.body?.reason, 500); const reporter = cleanText(req.body?.address, 100);
  if (!realm || !reason || reason.length < 8) return json(res, 400, { ok: false, error: 'Enter a realm path and a reason (at least 8 characters).' });
  const id = crypto.randomUUID();
  await mutateStore((store) => { store.reports.push({ id, realm, reason, reporter, status: 'pending', createdAt: new Date().toISOString() }); });
  res.status(201).json({ ok: true, id });
});

async function octopinFile(buffer, filename, mime, timeoutMs = 45_000) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), filename);
  const response = await fetch('https://upload.octopin.app/api/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OCTOPIN_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(timeoutMs)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.ok || !body?.data?.cid) {
    throw new Error(body?.error?.message || `Octopin upload failed (${response.status}).`);
  }
  return { cid: body.data.cid, gatewayUrl: `${OCTOPIN_GATEWAY}${body.data.cid}` };
}
app.post('/api/ipfs/image', writeLimiter, (req, res, next) => upload.single('file')(req, res, (e) => e ? next(e) : next()), async (req, res) => {
  try {
    if (!PINATA_JWT && !OCTOPIN_API_KEY) return json(res, 503, { ok: false, error: 'IPFS uploads are unavailable: the server has no pinning credential.' });
    if (!req.file) return json(res, 400, { ok: false, error: 'Choose a supported image file.' });
    if (uploadCounter.day !== new Date().toISOString().slice(0, 10)) { uploadCounter.day = new Date().toISOString().slice(0, 10); uploadCounter.count = 0; }
    if (uploadCounter.count >= MAX_UPLOADS_PER_DAY) return json(res, 429, { ok: false, error: 'Daily upload quota reached; try again tomorrow.' });
    const b = req.file.buffer; const mime = req.file.mimetype;
    const signatureOk = (mime === 'image/png' && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ||
      (mime === 'image/jpeg' && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ||
      (mime === 'image/webp' && b.subarray(0,4).toString() === 'RIFF' && b.subarray(8,12).toString() === 'WEBP') ||
      (mime === 'image/gif' && ['GIF87a','GIF89a'].includes(b.subarray(0,6).toString()));
    if (!signatureOk) return json(res, 400, { ok: false, error: 'The image content signature does not match its file type.' });
    let uploaded;
    if (PINATA_JWT) {
      const form = new FormData(); form.append('network', 'public'); form.append('name', cleanText(req.body?.name || req.file.originalname || 'morrow-artwork', 120));
      form.append('file', new Blob([b], { type: mime }), path.basename(req.file.originalname || 'artwork.webp'));
      const uploadResp = await fetch('https://uploads.pinata.cloud/v3/files', { method: 'POST', headers: { Authorization: `Bearer ${PINATA_JWT}` }, body: form, signal: AbortSignal.timeout(45000) });
      const body = await uploadResp.json().catch(() => ({}));
      if (!uploadResp.ok || !body?.data?.cid) return json(res, 502, { ok: false, error: cleanText(body?.error?.reason || body?.message || `Pinata upload failed (${uploadResp.status}).`, 220) });
      uploaded = { cid: body.data.cid, gatewayUrl: `${PINATA_GATEWAY}${body.data.cid}` };
    } else {
      uploaded = await octopinFile(b, path.basename(req.file.originalname || 'artwork.webp'), mime);
    }
    uploadCounter.count++;
    const cid = uploaded.cid; const uri = `ipfs://${cid}`; const gatewayUrl = uploaded.gatewayUrl;
    await mutateStore((store) => { store.uploads.push({ cid, name: cleanText(req.body?.name || req.file.originalname, 120), type: mime, size: b.length, time: new Date().toISOString() }); if (store.uploads.length > 2000) store.uploads = store.uploads.slice(-2000); });
    res.status(201).json({ ok: true, cid, uri, gatewayUrl, size: b.length, mimeType: mime });
  } catch (e) { next(e); }
});
app.post('/api/ipfs/metadata', writeLimiter, async (req, res) => {
  try {
    if (!PINATA_JWT && !OCTOPIN_API_KEY) return json(res, 503, { ok: false, error: 'IPFS metadata pinning is unavailable: the server has no pinning credential.' });
    const name = cleanText(req.body?.name, 100); const description = cleanText(req.body?.description, 1500); const image = String(req.body?.image || '').trim();
    const attributes = Array.isArray(req.body?.attributes) ? req.body.attributes.slice(0, 50).map((a) => ({ trait_type: cleanText(a?.trait_type, 100), value: cleanText(a?.value, 200) })) : [];
    if (!name || !image || !(/^ipfs:\/\/[a-zA-Z0-9]+/.test(image) || /^https:\/\//i.test(image))) return json(res, 400, { ok: false, error: 'Metadata needs a name and a valid public IPFS or HTTPS image URI.' });
    const metadata = { name, description, image, attributes, external_url: PUBLIC_URL };
    const json = Buffer.from(JSON.stringify(metadata, null, 2), 'utf8');
    const filename = `${name.replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 80)}.json`;
    let uploaded;
    if (PINATA_JWT) {
      const form = new FormData(); form.append('network', 'public'); form.append('name', filename); form.append('file', new Blob([json], { type: 'application/json' }), filename);
      const uploadResp = await fetch('https://uploads.pinata.cloud/v3/files', { method: 'POST', headers: { Authorization: `Bearer ${PINATA_JWT}` }, body: form, signal: AbortSignal.timeout(30000) });
      const body = await uploadResp.json().catch(() => ({}));
      if (!uploadResp.ok || !body?.data?.cid) return json(res, 502, { ok: false, error: cleanText(body?.error?.reason || body?.message || `Pinata metadata upload failed (${uploadResp.status}).`, 220) });
      uploaded = { cid: body.data.cid, gatewayUrl: `${PINATA_GATEWAY}${body.data.cid}` };
    } else {
      uploaded = await octopinFile(json, filename, 'application/json');
    }
    const cid = uploaded.cid; const uri = `ipfs://${cid}`;
    await mutateStore((store) => { store.uploads.push({ cid, name: metadata.name, type: 'application/json', size: json.length, time: new Date().toISOString() }); if (store.uploads.length > 2000) store.uploads = store.uploads.slice(-2000); });
    res.status(201).json({ ok: true, cid, uri, gatewayUrl: uploaded.gatewayUrl, metadata });
  } catch (e) { json(res, 502, { ok: false, error: cleanText(e.message, 220) }); }
});
app.get('/api/contracts/collection-template', async (_req, res) => {
  try { res.type('text/plain').send(await fs.readFile(path.join(ROOT, 'contracts', 'templates', 'morrow-collection.gno'), 'utf8')); }
  catch { json(res, 404, { ok: false, error: 'Collection contract template is missing from this build.' }); }
});
app.get('/api/contracts/registry-template', async (_req, res) => {
  try { res.type('text/plain').send(await fs.readFile(path.join(ROOT, 'contracts', 'registry', 'morrowmarket.gno'), 'utf8')); }
  catch { json(res, 404, { ok: false, error: 'Morrow registry source is missing from this build.' }); }
});
app.get('/api/admin/queue', adminAuth, async (_req, res) => {
  try { const store = await readStore(); const market = await getMarket().catch(() => ({ collections: [] })); res.json({ ok: true, reports: store.reports.slice(-300).reverse(), collections: market.collections, verifiedPaths: store.verifiedPaths, uploadCount: store.uploads.length }); }
  catch (e) { json(res, 500, { ok: false, error: cleanText(e.message, 220) }); }
});
app.post('/api/admin/verify', adminAuth, writeLimiter, async (req, res) => {
  const realm = toCollectionPath(req.body?.realm); const verified = req.body?.verified === true;
  if (!realm) return json(res, 400, { ok: false, error: 'Invalid realm path.' });
  if (verified) verifiedPaths.add(realm); else verifiedPaths.delete(realm);
  await mutateStore((store) => { store.verifiedPaths = [...verifiedPaths]; });
  res.json({ ok: true, realm, verified });
});
app.post('/api/admin/report-status', adminAuth, writeLimiter, async (req, res) => {
  const id = cleanText(req.body?.id, 100); const status = String(req.body?.status || '');
  if (!['pending','reviewing','resolved','dismissed'].includes(status)) return json(res, 400, { ok: false, error: 'Unsupported report status.' });
  let found = false;
  await mutateStore((store) => { const report = store.reports.find((r) => r.id === id); if (report) { report.status = status; report.updatedAt = new Date().toISOString(); found = true; } });
  if (!found) return json(res, 404, { ok: false, error: 'Report not found.' });
  res.json({ ok: true });
});
app.use((err, _req, res, _next) => {
  if (res.headersSent) return;
  // Body-parser and other client errors carry their own status; do not report them as server faults.
  const status = err instanceof multer.MulterError
    ? (err.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
    : Number(err?.status || err?.statusCode) >= 400 && Number(err?.status || err?.statusCode) < 500
      ? Number(err.status || err.statusCode)
      : 500;
  if (status === 500) console.error('Morrow request error:', err.message);
  res.status(status).json({
    ok: false,
    error: status === 500 ? 'Request failed. Check server logs for the internal error.' : cleanText(err.message, 220)
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Morrow Marketplace listening on http://127.0.0.1:${PORT}`);
  console.log(`Network: ${CHAIN_ID}; RPC: ${RPC_URL}`);
  console.log(`Morrow registry: ${REGISTRY_PATH || 'NOT CONFIGURED'}; read-only unless registry, treasury and network flag are configured.`);
});
