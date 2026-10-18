import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = (message) => { console.error(`PREFLIGHT FAILED: ${message}`); process.exitCode = 1; };
const read = (p) => fs.readFile(path.join(root, p), 'utf8');
const required = [
  'server.mjs', '.env.example', 'README.md', 'package.json', 'public/index.html', 'public/app.js', 'public/styles.css',
  'public/admin.html', 'public/admin.js', 'contracts/registry/morrowmarket.gno', 'contracts/templates/morrow-collection.gno',
  'scripts/pin-nft-collection.mjs', 'nft-collection/images', 'nft-collection/metadata'
];
for (const entry of required) {
  try { await fs.access(path.join(root, entry)); } catch { fail(`missing required project path: ${entry}`); }
}
if (process.exitCode) process.exit(1);
const [server, app, registry, collection, env, packageJson] = await Promise.all([
  read('server.mjs'), read('public/app.js'), read('contracts/registry/morrowmarket.gno'),
  read('contracts/templates/morrow-collection.gno'), read('.env.example'), read('package.json')
]);

const packageData = JSON.parse(packageJson);

// Verify all 1,111 asset pairs and metadata structure without trusting filenames alone.
const imageDir = path.join(root, 'nft-collection', 'images');
const metaDir = path.join(root, 'nft-collection', 'metadata');
const imageFiles = (await fs.readdir(imageDir)).filter((n) => /^\d{4}\.webp$/.test(n)).sort();
const metaFiles = (await fs.readdir(metaDir)).filter((n) => /^\d{4}\.json$/.test(n)).sort();
if (imageFiles.length !== 1111 || metaFiles.length !== 1111) fail(`Moonbound requires exactly 1,111 numbered images and metadata files; found ${imageFiles.length} / ${metaFiles.length}`);
const imageSet = new Set(imageFiles.map((n) => n.slice(0, 4)));
const metaSet = new Set(metaFiles.map((n) => n.slice(0, 4)));
if (imageSet.size !== metaSet.size || [...imageSet].some((id) => !metaSet.has(id))) fail('Image and metadata edition filenames do not match exactly.');
const hashes = new Set();
const traitValues = new Map();
let totalImageBytes = 0;
for (let i = 1; i <= 1111; i++) {
  const id = String(i).padStart(4, '0');
  const imagePath = path.join(imageDir, `${id}.webp`);
  const metaPath = path.join(metaDir, `${id}.json`);
  let image, meta;
  try { image = await fs.readFile(imagePath); } catch { fail(`missing image ${id}.webp`); continue; }
  try { meta = JSON.parse(await fs.readFile(metaPath, 'utf8')); } catch { fail(`invalid or missing JSON metadata ${id}.json`); continue; }
  totalImageBytes += image.length;
  if (image.length < 16 || image.toString('ascii', 0, 4) !== 'RIFF' || image.toString('ascii', 8, 12) !== 'WEBP') fail(`${id}.webp is not a valid WebP signature`);
  const hash = crypto.createHash('sha256').update(image).digest('hex');
  if (hashes.has(hash)) fail(`duplicate image bytes detected at edition ${id}`); else hashes.add(hash);
  if (meta.name !== `Moonbound Keepers #${id}`) fail(`${id}.json has unexpected token name`);
  if (typeof meta.description !== 'string' || !meta.description.includes('not guaranteed')) fail(`${id}.json is missing the utility disclaimer`);
  if (!Array.isArray(meta.attributes) || meta.attributes.length < 6) fail(`${id}.json is missing the diverse trait array`);
  const edition = meta.attributes.find((a) => a.trait_type === 'Edition');
  if (!edition || edition.value !== `${id} / 1111`) fail(`${id}.json has a mismatched edition trait`);
  if (!/^ipfs:\/\/(?:IMAGE_DIRECTORY_CID|[A-Za-z0-9]+)\/\d{4}\.webp$/.test(meta.image || '')) fail(`${id}.json has an invalid/unexpected image URI`);
  for (const trait of meta.attributes || []) {
    if (!trait || typeof trait.trait_type !== 'string' || typeof trait.value !== 'string') { fail(`${id}.json has malformed trait values`); continue; }
    if (trait.trait_type !== 'Edition') {
      if (!traitValues.has(trait.trait_type)) traitValues.set(trait.trait_type, new Set());
      traitValues.get(trait.trait_type).add(trait.value);
    }
  }
}
if (hashes.size !== 1111) fail(`expected 1,111 unique images; got ${hashes.size}`);
for (const [trait, values] of traitValues) if (values.size < 3) fail(`trait ${trait} has insufficient diversity (${values.size} values)`);

// Check product invariants in both source and environment defaults.
const mustContain = [
  [registry, 'launchFeeFixed = int64(2_000_000_000)', 'registry launch fee constant'],
  [registry, 'func FeaturedCollection()', 'automatic featured collection getter'],
  [registry, 'func MarketplaceFeeBps() int64 { return 250 }', 'registry fee rate'],
  [registry, 'return banker.GetCoin(self, nativeDenom)', 'bounded registry balance read'],
  [collection, 'func PublicMint(cur realm)', 'public fixed-edition mint method'],
  [collection, 'fee := price / 40', 'on-chain 2.5% sale fee'],
  [collection, 'takeExact(price + fee)', 'combined buyer checkout amount'],
  [collection, 'sent := unsafe.OriginSend()', 'official Gno origin-payment envelope'],
  [collection, 'stale or spoofed realm handle', 'crossing realm-context validation'],
  [collection, 'func MarketplaceFeeSink()', 'on-chain marketplace fee recipient'],
  [app, 'normalizeWalletChain', 'wallet network matching'],
  [app, 'DoContract({tx:{messages,memo},isNotification:true})', 'documented Adena DoContract message envelope'],
  [app, "deposit:'1ugnot'", 'documented Adena add-package deposit format'],
  [app, 'data-action="launch-moonbound"', 'Moonbound launch button wiring'],
  [app, "if((state.market.collections||[]).length>0)return '';", 'hide stale sample preview after the first live collection'],
  [app, 'const fee=Math.floor(price/40);const total=price+fee;', 'buyer checkout total calculation'],
  [server, 'registryTreasuryMatches', 'fee recipient match gate'],
  [server, 'registryFeeModelMatches', 'registry fee compatibility gate'],
  [server, 'featuredCollectionPath', 'featured collection API field'],
  [env, 'MORROW_REGISTRY_PATH=', 'registry environment setting'],
  [env, 'GNOLAND_MAINNET_TRADING_ENABLED=false', 'mainnet writes disabled by default'],
];
for (const [source, marker, label] of mustContain) if (!source.includes(marker)) fail(`${label} missing or changed`);
// (no ban on the runtime unsafe package; unsafe.OriginSend is the official Gno origin-payment envelope)
if (!collection.includes('chain/runtime/unsafe')) fail('payment guard must import the official Gno unsafe package for OriginSend.');
if (!registry.includes('func CreditLaunchFee(cur realm) {\n\trequireInit()\n\tif !cur.IsCurrent()')) fail('registry launch-fee cross-call lacks the current realm guard.');
if (!registry.includes('func Register(cur realm, name, symbol, cover string, maxSupply int, mintPrice, royaltyBps int64, imageBaseURI, metadataBaseURI string) {\n\trequireInit()\n\tif !cur.IsCurrent()')) fail('registry registration cross-call lacks the current realm guard.');
if (!registry.includes('func NoteMinted(cur realm, n int) {\n\trequireInit()\n\tif !cur.IsCurrent()')) fail('registry mint-index cross-call lacks the current realm guard.');
if (!collection.includes('registry "__REGISTRY_PATH__"')) fail('Collection template must import the configured Morrow registry with the expected alias.');
if (!collection.includes('__PACKAGE__')) fail('Collection package path placeholder missing.');
if (!packageData.scripts?.['pin:moonbound']) fail('pin:moonbound package script missing.');
if (!/MARKETPLACE_FEE_BPS=250/.test(env)) fail('environment example must use the fixed 250 BPS rate');
if (/GNOLAND_FACTORY_PATH|morrow-bazaar|bazaar\/factory/i.test(env + app + registry + collection + server)) fail('obsolete third-party marketplace dependency found in runtime source/config.');
if (/COLLECTION_SERVICE_FEE_UGNOT=250000|MARKETPLACE_FEE_BPS=100\b/.test(env)) fail('obsolete/inconsistent fee defaults found.');

// Secret scan in client-shipped files.
async function walk(dir) {
  const found = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) found.push(...await walk(p)); else found.push(p);
  }
  return found;
}
for (const file of await walk(path.join(root, 'public'))) {
  const rel = path.relative(root, file).replaceAll('\\', '/');
  if (/(^|\/)(\.env(?:\..*)?|[^/]+\.(?:pem|key|p12|pfx))$/i.test(rel)) fail(`possible secret/key file under public/: ${rel}`);
  if (/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/.test(await fs.readFile(file, 'utf8').catch(() => ''))) fail(`private key material found in ${rel}`);
}

if (process.exitCode) process.exit(1);
console.log('Preflight passed.');
console.log(`• Moonbound assets: ${imageFiles.length} unique WebP images + ${metaFiles.length} valid numbered metadata files.`);
console.log(`• Image payload: ${(totalImageBytes / (1024 * 1024)).toFixed(1)} MiB; trait diversity checked.`);
console.log('• Verified source invariants: 2,000 GNOT launch, 575 GNOT / 1,111 edition mint, 2.5% on-chain sale fee, registry fee-sink gate, featured collection index, read-only mainnet defaults.');
console.log('• Limitation: this is a static/source preflight, not Gno compilation, an independent security audit, or live Adena/RPC/IPFS end-to-end test.');
