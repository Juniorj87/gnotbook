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
const TREASURY = String(process.env.MORROW_TREASURY_ADDRESS || '').trim();
const MARKETPLACE_FEE_BPS = intEnv('MARKETPLACE_FEE_BPS', 250, 250, 250);
const COLLECTION_SERVICE_FEE_UGNOT = 2_000_000_000; // Fixed in the registry contract: 2,000 GNOT.
const MAINNET_TX_ENABLED = /^(1|true|yes)$/i.test(process.env.GNOLAND_MAINNET_TRADING_ENABLED || 'false');
const ONYX_TX_ENABLED = /^(1|true|yes)$/i.test(process.env.GNOLAND_ONYX_TRADING_ENABLED || 'false');
const PINATA_JWT = String(process.env.PINATA_JWT || '').trim();
const PINATA_GATEWAY = normalizeGateway(process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud/ipfs/');
const MAX_UPLOAD_MB = intEnv('MAX_UPLOAD_MB', 15, 1, 40);
const MAX_UPLOADS_PER_DAY = intEnv('MAX_UPLOADS_PER_DAY', 100, 1, 10000);
const MOONBOUND_IMAGE_BASE_URI = cleanIpfsBase(process.env.MOONBOUND_IMAGE_BASE_URI || '');
const MOONBOUND_METADATA_BASE_URI = cleanIpfsBase(process.env.MOONBOUND_METADATA_BASE_URI || '');
const MOONBOUND_COLLECTION_PATH = cleanPkgPath(process.env.MOONBOUND_COLLECTION_PATH || '');
const MOONBOUND_MINT_PRICE_UGNOT = 575_000_000;
const MOONBOUND_MAX_SUPPLY = 1111;
const ADMIN_TOKEN = String(process.env.MORROW_ADMIN_TOKEN || '');
const verifiedPaths = new Set((process.env.VERIFIED_COLLECTION_PATHS || '').split(',').map(cleanPkgPath).filter(Boolean));
const STORE_PATH = path.join(ROOT, 'data', 'store.json');
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
  if (!/^https:\/\//i.test(out)) throw new Error('PINATA_GATEWAY must use HTTPS.');
  if (!out.endsWith('/')) out += '/';
  return out;
}
function cleanPkgPath(value) {
  const out = String(value || '').trim().replace(/^https?:\/\/[^/]+\//i, '').replace(/^\/+/, '').replace(/\$source.*$/, '');
  if (!out || out.length > 256) return '';
  if (!/^gno\.land\/r\/[a-z0-9]+(?:\/[a-z0-9_-]+)+$/i.test(out)) return '';
  const finalName = out.split('/').at(-1);
  return /^[a-z][a-z0-9_]+$/.test(finalName) ? out : '';
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
async function abciQuery(queryPath, data = '') {
  const params = { path: queryPath };
  if (data !== '') params.data = Buffer.from(String(data)).toString('base64');
  const result = await rpc('abci_query', params);
  const base = result?.response?.ResponseBase;
  if (!base) throw new Error('Unexpected Gno RPC query response.');
  if (base.Error) throw new Error(typeof base.Error === 'string' ? base.Error : (base.Error.message || JSON.stringify(base.Error)));
  return { raw: result, data: decodeBase64(base.Data).toString('utf8'), height: result?.response?.Height || null };
}
async function evalValues(pkg, func, args = []) {
  const clean = cleanPkgPath(pkg);
  if (!clean || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(func))) throw new Error('Invalid Gno realm query.');
  const exprArgs = args.map((arg) => {
    const v = String(arg);
    if (/^-?\d+$/.test(v)) return v;
    if (v === 'true' || v === 'false') return v;
    return JSON.stringify(v);
  });
  const expr = `${clean}.${func}(${exprArgs.join(',')})`;
  const out = await abciQuery('vm/qeval_json', expr);
  let parsed;
  try { parsed = JSON.parse(out.data); } catch { throw new Error('Gno returned invalid structured data.'); }
  if (!Array.isArray(parsed)) return [decodeAmino(parsed)];
  return parsed.map(decodeAmino);
}
async function evalValue(pkg, func, args = []) {
  const values = await evalValues(pkg, func, args);
  return values.length === 1 ? values[0] : values;
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
  if (v.startsWith('ipfs://')) return `${PINATA_GATEWAY}${v.slice(7).replace(/^ipfs\//, '')}`;
  return /^https:\/\//i.test(v) ? v : '';
}
function toCollectionPath(v) { return cleanPkgPath(v); }
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
async function getCollections() {
  if (!REGISTRY_PATH) return { collections: [], warning: 'Morrow registry path is not configured.' };
  const rowsValue = await evalValue(REGISTRY_PATH, 'ListCollections').catch((e) => { throw new Error(`Morrow registry query failed: ${e.message}`); });
  const persisted = await readStore().catch(() => ({ verifiedPaths: [] }));
  const activeVerified = new Set([...verifiedPaths, ...(persisted.verifiedPaths || [])].map(toCollectionPath).filter(Boolean));
  const paths = parseRecordLines(rowsValue).map(normalizeRegistryRow).filter(Boolean);
  const collections = await Promise.all(paths.map(async (c) => {
    try {
      const dynamic = await readCollection(c.path);
      return { ...c, ...dynamic, verified: activeVerified.has(c.path) };
    } catch { return { ...c, verified: activeVerified.has(c.path) }; }
  }));
  const featuredRaw = await evalValue(REGISTRY_PATH, 'FeaturedCollection').catch(() => '');
  const featuredCollectionPath = toCollectionPath(featuredRaw);
  return { collections: collections.map((c) => ({ ...c, featured: c.path === featuredCollectionPath })), warning: '', featuredCollectionPath };
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
    const raw = await evalValue(c.path, 'ListOpen').catch(() => '');
    return parseOpenItems(raw, c);
  }));
  return { ok: !warning, collections, listings: listingSets.flat().sort((a, b) => b.id - a.id), warning, registryPath: REGISTRY_PATH, featuredCollectionPath };
}
async function readBalances(address) {
  if (!safeAddress(address)) throw new Error('Invalid Gno address.');
  const result = await abciQuery(`bank/balances/${address}`);
  let parsed = {};
  try { parsed = JSON.parse(result.data || '{}'); } catch { parsed = {}; }
  const balances = Array.isArray(parsed.balances) ? parsed.balances : Array.isArray(parsed) ? parsed : Array.isArray(parsed.coins) ? parsed.coins : [];
  return balances.map((b) => ({ denom: cleanText(b.denom, 100), amount: String(b.amount || '0') }));
}
async function readStore() {
  if (process.env.DATABASE_URL) {
    try {
      if (!pgPool) {
        const { Pool } = await import('pg');
        pgPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: /^(true|1)$/i.test(process.env.PGSSL || 'false') ? { rejectUnauthorized: false } : undefined, max: 5, idleTimeoutMillis: 10000, connectionTimeoutMillis: 5000 });
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
function emptyStore() { return { points: {}, rewards: [], reports: [], uploads: [], verifiedPaths: [...verifiedPaths] }; }
function normalizeStore(s) { const d = s && typeof s === 'object' ? s : {}; return { points: d.points && typeof d.points === 'object' ? d.points : {}, rewards: Array.isArray(d.rewards) ? d.rewards : [], reports: Array.isArray(d.reports) ? d.reports : [], uploads: Array.isArray(d.uploads) ? d.uploads : [], verifiedPaths: Array.isArray(d.verifiedPaths) ? d.verifiedPaths : [...verifiedPaths] }; }
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
  await fs.writeFile(tmp, JSON.stringify(normalized, null, 2), { mode: 0o600 });
  await fs.rename(tmp, STORE_PATH);
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
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
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
const generalLimiter = rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: 'draft-7', legacyHeaders: false });
const writeLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 }, fileFilter: (_req, file, cb) => {
  const allowed = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  if (!allowed.has(file.mimetype)) return cb(new Error('Only PNG, JPEG, WEBP and GIF images are accepted. SVG and HTML uploads are disabled.'));
  cb(null, true);
} });
app.use('/api/', generalLimiter);
app.get('/admin', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'admin.html')));
app.use(express.static(path.join(ROOT, 'public'), { index: 'index.html', maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0, etag: true }));
app.use('/collection-assets', express.static(path.join(ROOT, 'nft-collection'), { fallthrough: false, maxAge: '1h', index: false }));

app.get('/healthz', (_req, res) => res.json({ ok: true, uptimeSeconds: Math.floor(process.uptime()), chainId: CHAIN_ID }));
app.get('/api/config', async (_req, res) => {
  let rpcHealthy = false; let latestHeight = null; let rpcError = '';
  try { const status = await rpc('status', {}, 4000); rpcHealthy = !!status?.sync_info; latestHeight = status?.sync_info?.latest_block_height || null; }
  catch (e) { rpcError = cleanText(e.message, 180); }
  let registeredCollections = []; let featuredCollectionPath = '';
  if (REGISTRY_PATH) {
    try { const registryRead = await getCollections(); registeredCollections = registryRead.collections; featuredCollectionPath = registryRead.featuredCollectionPath || ''; }
    catch (e) { if (!rpcError) rpcError = cleanText(e.message, 180); }
  }
  const moonboundRegistered = registeredCollections.find((c) => c.slug === 'moonbound') || null;
  const moonboundPath = moonboundRegistered?.path || MOONBOUND_COLLECTION_PATH || '';
  // Once deployed, the chain is authoritative. Environment values are only launch inputs,
  // never a way to override a live collection's on-chain content addresses.
  const imageBaseURI = moonboundRegistered?.imageBaseURI || MOONBOUND_IMAGE_BASE_URI || '';
  const metadataBaseURI = moonboundRegistered?.metadataBaseURI || MOONBOUND_METADATA_BASE_URI || '';
  const assetsConfigured = !!imageBaseURI && !!metadataBaseURI;
  const registryConfigured = !!REGISTRY_PATH;
  const networkWritesEnabled = isMainnet() ? MAINNET_TX_ENABLED : (CHAIN_ID === 'onyx-1' ? ONYX_TX_ENABLED : false);
  const registryFeeSink = registryConfigured ? cleanText(await evalValue(REGISTRY_PATH, 'FeeSink').catch(() => ''), 100) : '';
  const registryLaunchFeeRaw = registryConfigured ? await evalValue(REGISTRY_PATH, 'LaunchFee').catch(() => null) : null;
  const registryProtocolBpsRaw = registryConfigured ? await evalValue(REGISTRY_PATH, 'MarketplaceFeeBps').catch(() => null) : null;
  const registryLaunchFee = registryLaunchFeeRaw === null ? null : num(registryLaunchFeeRaw, -1);
  const registryProtocolBps = registryProtocolBpsRaw === null ? null : num(registryProtocolBpsRaw, -1);
  const registryTreasuryMatches = safeAddress(TREASURY) && safeAddress(registryFeeSink) && registryFeeSink.toLowerCase() === TREASURY.toLowerCase();
  const registryFeeModelMatches = registryLaunchFee === COLLECTION_SERVICE_FEE_UGNOT && registryProtocolBps === 250;
  const registryCompatible = registryConfigured && registryTreasuryMatches && registryFeeModelMatches;
  const bootstrapEnabled = networkWritesEnabled && safeAddress(TREASURY) && !registryConfigured;
  const transactionsEnabled = networkWritesEnabled && registryCompatible;
  const registryError = !registryConfigured
    ? 'Deploy the Morrow registry, then set MORROW_REGISTRY_PATH and restart the server.'
    : !registryTreasuryMatches
      ? 'Registry FeeSink() must match MORROW_TREASURY_ADDRESS exactly. Write operations are blocked.'
      : !registryFeeModelMatches
        ? 'The configured registry does not expose the exact 2,000 GNOT launch fee and 2.5% marketplace fee. Write operations are blocked.'
        : !networkWritesEnabled
          ? `Write operations are disabled for ${CHAIN_ID}; explicitly enable the appropriate network flag after review.`
          : '';
  const moonboundLaunchEnabled = transactionsEnabled && !!PINATA_JWT && !moonboundRegistered && !!MOONBOUND_IMAGE_BASE_URI && !!MOONBOUND_METADATA_BASE_URI;
  const onchainLaunchFee = registryLaunchFee ?? COLLECTION_SERVICE_FEE_UGNOT;
  res.json({
    ok: true, product: 'Morrow Marketplace', chainId: CHAIN_ID, rpcUrl: RPC_URL, registryPath: REGISTRY_PATH, featuredCollectionPath,
    treasuryConfigured: safeAddress(TREASURY), treasuryAddress: safeAddress(TREASURY) ? TREASURY : '',
    marketplaceFeeBps: MARKETPLACE_FEE_BPS, collectionServiceFeeUgnot: onchainLaunchFee, launchFeeGnot: onchainLaunchFee / 1_000_000,
    tradingEnabled: transactionsEnabled, transactionsEnabled, bootstrapEnabled, registryCompatible, registryFeeModelMatches, registryTreasuryMatches,
    mainnetTransfersAdminEnabled: MAINNET_TX_ENABLED, onyxTransactionsAdminEnabled: ONYX_TX_ENABLED,
    pinningConfigured: !!PINATA_JWT, pinataGateway: PINATA_GATEWAY,
    rpcHealthy, latestHeight, rpcError, maxUploadMB: MAX_UPLOAD_MB,
    moonbound: {
      name: 'Moonbound Keepers', symbol: 'MBK', maxSupply: MOONBOUND_MAX_SUPPLY,
      mintPriceUgnot: MOONBOUND_MINT_PRICE_UGNOT, imageBaseUri: imageBaseURI, metadataBaseUri: metadataBaseURI,
      assetsConfigured, collectionPath: moonboundPath, collectionConfigured: !!moonboundRegistered,
      minted: moonboundRegistered?.minted || 0, launchEnabled: moonboundLaunchEnabled,
      mintEnabled: transactionsEnabled && !!moonboundRegistered && moonboundRegistered.maxSupply === MOONBOUND_MAX_SUPPLY && moonboundRegistered.mintPriceUgnot === MOONBOUND_MINT_PRICE_UGNOT && !!moonboundRegistered.imageBaseURI && !!moonboundRegistered.metadataBaseURI,
      externalPath: moonboundPath ? `https://gno.land/${moonboundPath.replace(/^gno\.land\//, '')}` : ''
    },
    points: { buy: 10, list: 5, mint: 8, launch: 15 },
    guardians: { url: 'https://guardians.family/', integration: 'external-official-link', mintActive: false, note: 'Morrow links to the official project page. Verify availability and transaction details directly with Guardians.' },
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
    const collection = collections.find((c) => c.path === pkg);
    if (!collection) return json(res, 404, { ok: false, error: 'That realm is not registered in Morrow.' });
    const maxId = Math.max(0, num(await evalValue(pkg, 'NextID').catch(() => collection.minted)));
    const startId = maxId - offset;
    if (startId < 1) return res.json({ ok: true, items: [], total: maxId, offset, limit, hasMore: false });
    const raw = await evalValue(pkg, 'ItemLines', [startId, limit]).catch(async () => {
      // Compatibility fallback for existing Morrow realms deployed before pagination.
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
// Trait aggregates for a locally pinned drop. Traits are public in the pinned metadata while
// art stays hidden until mint, so this is real pre-reveal data, not a preview of anything.
async function aggregateTraits() {
  const dir = path.join(ROOT, 'nft-collection', 'metadata');
  const files = (await fs.readdir(dir)).filter((f) => /^\d{4}\.json$/.test(f)).sort();
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
  return {
    total: files.length,
    // Groups whose every value is unique per edition (an "Edition" number trait) are not facets.
    groups: [...groups].filter(([, values]) => values.size < files.length).map(([trait_type, values]) => ({ trait_type, values: [...values].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count) })),
    editions
  };
}
let traitCache = null;
app.get('/api/traits', async (req, res) => {
  const slug = cleanText(String(req.query.collection || ''), 32).toLowerCase();
  if (slug && slug !== 'moonbound') return json(res, 404, { ok: false, error: 'Trait aggregates are bundled for the Moonbound Keepers drop only.' });
  try {
    if (!traitCache) traitCache = await aggregateTraits();
    res.json({ ok: true, collection: 'moonbound', ...traitCache });
  } catch (e) { json(res, 502, { ok: false, error: cleanText(e.message, 200) }); }
});
app.get('/api/realm-read', async (req, res) => {
  try {
    const pkg = toCollectionPath(req.query.pkg); const func = String(req.query.func || '');
    const args = Array.isArray(req.query.arg) ? req.query.arg : req.query.arg == null ? [] : [req.query.arg];
    const allowedFuncs = new Set(['Name', 'Symbol', 'Creator', 'Cover', 'MaxSupply', 'Minted', 'MintPrice', 'RoyaltyBps', 'ImageBaseURI', 'AssetBaseURI', 'MetadataBaseURI', 'MarketplaceFeeBps', 'MarketplaceFeeSink', 'NextID', 'ItemLines', 'ItemLine', 'ListOpen', 'TokensOf', 'OwnerOf']);
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
app.get('/api/portfolio/:address', async (req, res) => {
  const address = String(req.params.address || '');
  if (!safeAddress(address)) return json(res, 400, { ok: false, error: 'Invalid Gno address.' });
  try {
    const { collections } = await getCollections();
    const tokens = []; const ownedCollections = [];
    for (const collection of collections.slice(0, 80)) {
      const idsValue = await evalValue(collection.path, 'TokensOf', [address]).catch(() => '');
      const ids = String(idsValue || '').split(',').filter((v) => /^\d+$/.test(v)).slice(0, 400);
      if (!ids.length) continue;
      ownedCollections.push(collection);
      const details = await Promise.all(ids.map(async (id) => {
        const [name, image, owner, price, listed] = await Promise.all([
          evalValue(collection.path, 'NameOf', [id]).catch(() => ''), evalValue(collection.path, 'ImageOf', [id]).catch(() => ''),
          evalValue(collection.path, 'GrcOwnerOf', [id]).catch(() => address), evalValue(collection.path, 'PriceOf', [id]).catch(() => 0),
          evalValue(collection.path, 'Listed', [id]).catch(() => false)
        ]);
        return { id, name: cleanText(name, 100), image: ipfsUrl(image) || image || collection.image, owner, priceUgnot: num(price), listed: listed === true || String(listed) === 'true', collectionName: collection.name, collectionPath: collection.path, verified: collection.verified, royaltyBps: collection.royaltyBps, preview: false };
      }));
      tokens.push(...details.filter((t) => t.name));
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

app.post('/api/ipfs/image', writeLimiter, (req, res, next) => upload.single('file')(req, res, (e) => e ? next(e) : next()), async (req, res) => {
  try {
    if (!PINATA_JWT) return json(res, 503, { ok: false, error: 'IPFS uploads are unavailable: configure PINATA_JWT on the server.' });
    if (!req.file) return json(res, 400, { ok: false, error: 'Choose a supported image file.' });
    if (uploadCounter.day !== new Date().toISOString().slice(0, 10)) { uploadCounter.day = new Date().toISOString().slice(0, 10); uploadCounter.count = 0; }
    if (uploadCounter.count >= MAX_UPLOADS_PER_DAY) return json(res, 429, { ok: false, error: 'Daily upload quota reached; try again tomorrow.' });
    const b = req.file.buffer; const mime = req.file.mimetype;
    const signatureOk = (mime === 'image/png' && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ||
      (mime === 'image/jpeg' && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ||
      (mime === 'image/webp' && b.subarray(0,4).toString() === 'RIFF' && b.subarray(8,12).toString() === 'WEBP') ||
      (mime === 'image/gif' && ['GIF87a','GIF89a'].includes(b.subarray(0,6).toString()));
    if (!signatureOk) return json(res, 400, { ok: false, error: 'The image content signature does not match its file type.' });
    const form = new FormData(); form.append('network', 'public'); form.append('name', cleanText(req.body?.name || req.file.originalname || 'morrow-artwork', 120));
    form.append('file', new Blob([b], { type: mime }), path.basename(req.file.originalname || 'artwork.webp'));
    const uploadResp = await fetch('https://uploads.pinata.cloud/v3/files', { method: 'POST', headers: { Authorization: `Bearer ${PINATA_JWT}` }, body: form, signal: AbortSignal.timeout(45000) });
    const body = await uploadResp.json().catch(() => ({}));
    if (!uploadResp.ok || !body?.data?.cid) return json(res, 502, { ok: false, error: cleanText(body?.error?.reason || body?.message || `Pinata upload failed (${uploadResp.status}).`, 220) });
    uploadCounter.count++;
    const cid = body.data.cid; const uri = `ipfs://${cid}`; const gatewayUrl = `${PINATA_GATEWAY}${cid}`;
    await mutateStore((store) => { store.uploads.push({ cid, name: cleanText(req.body?.name || req.file.originalname, 120), type: mime, size: b.length, time: new Date().toISOString() }); if (store.uploads.length > 2000) store.uploads = store.uploads.slice(-2000); });
    res.status(201).json({ ok: true, cid, uri, gatewayUrl, size: b.length, mimeType: mime });
  } catch (e) { next(e); }
});
app.post('/api/ipfs/metadata', writeLimiter, async (req, res) => {
  try {
    if (!PINATA_JWT) return json(res, 503, { ok: false, error: 'IPFS metadata pinning is unavailable: configure PINATA_JWT on the server.' });
    const name = cleanText(req.body?.name, 100); const description = cleanText(req.body?.description, 1500); const image = String(req.body?.image || '').trim();
    const attributes = Array.isArray(req.body?.attributes) ? req.body.attributes.slice(0, 50).map((a) => ({ trait_type: cleanText(a?.trait_type, 100), value: cleanText(a?.value, 200) })) : [];
    if (!name || !image || !(/^ipfs:\/\/[a-zA-Z0-9]+/.test(image) || /^https:\/\//i.test(image))) return json(res, 400, { ok: false, error: 'Metadata needs a name and a valid public IPFS or HTTPS image URI.' });
    const metadata = { name, description, image, attributes, external_url: 'https://morrow.market' };
    const form = new FormData(); form.append('network', 'public'); form.append('name', `${name.replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 80)}.json`); form.append('file', new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' }), `${name.replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 80)}.json`);
    const uploadResp = await fetch('https://uploads.pinata.cloud/v3/files', { method: 'POST', headers: { Authorization: `Bearer ${PINATA_JWT}` }, body: form, signal: AbortSignal.timeout(30000) });
    const body = await uploadResp.json().catch(() => ({}));
    if (!uploadResp.ok || !body?.data?.cid) return json(res, 502, { ok: false, error: cleanText(body?.error?.reason || body?.message || `Pinata metadata upload failed (${uploadResp.status}).`, 220) });
    const cid = body.data.cid; const uri = `ipfs://${cid}`;
    await mutateStore((store) => { store.uploads.push({ cid, name: metadata.name, type: 'application/json', size: Buffer.byteLength(JSON.stringify(metadata)), time: new Date().toISOString() }); if (store.uploads.length > 2000) store.uploads = store.uploads.slice(-2000); });
    res.status(201).json({ ok: true, cid, uri, gatewayUrl: `${PINATA_GATEWAY}${cid}`, metadata });
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
  const status = err instanceof multer.MulterError ? (err.code === 'LIMIT_FILE_SIZE' ? 413 : 400) : 500;
  if (status === 500) console.error('Morrow request error:', err.message);
  res.status(status).json({ ok: false, error: status === 500 ? 'Request failed. Check server logs for the internal error.' : cleanText(err.message, 220) });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Morrow Marketplace listening on http://127.0.0.1:${PORT}`);
  console.log(`Network: ${CHAIN_ID}; RPC: ${RPC_URL}`);
  console.log(`Morrow registry: ${REGISTRY_PATH || 'NOT CONFIGURED'}; read-only unless registry, treasury and network flag are configured.`);
});
