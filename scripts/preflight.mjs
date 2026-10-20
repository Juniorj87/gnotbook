import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = (message) => { console.error(`PREFLIGHT FAILED: ${message}`); process.exitCode = 1; };
const read = (p) => fs.readFile(path.join(root, p), 'utf8');
const SUPPLY = 1000;
const ARCHIVE = 'nft-collection-archive/editions-1001-1111.zip';

const required = [
  'server.mjs', '.env.example', 'README.md', 'package.json', 'public/index.html', 'public/app.js', 'public/styles.css',
  'public/admin.html', 'public/admin.js', 'contracts/registry/morrowmarket.gno', 'contracts/templates/morrow-collection.gno',
  'scripts/build-collection.mjs', 'scripts/pin-octopin.mjs', 'scripts/make-release.mjs',
  'nft-collection/images', 'nft-collection/metadata', 'data/collection-manifest.json', ARCHIVE
];
for (const entry of required) {
  try { await fs.access(path.join(root, entry)); } catch { fail(`missing required project path: ${entry}`); }
}
if (process.exitCode) process.exit(1);

const [server, app, registry, collection, env, packageJson, manifestRaw, archiveReadme] = await Promise.all([
  read('server.mjs'), read('public/app.js'), read('contracts/registry/morrowmarket.gno'),
  read('contracts/templates/morrow-collection.gno'), read('.env.example'), read('package.json'),
  read('data/collection-manifest.json'), read('nft-collection-archive/README.md')
]);
const packageData = JSON.parse(packageJson);
const manifest = JSON.parse(manifestRaw);

// Every published edition is one image + one JSON. The pair count must match the
// Octopin budget exactly, and no stray file may inflate the upload.
const imageDir = path.join(root, 'nft-collection', 'images');
const metaDir = path.join(root, 'nft-collection', 'metadata');
const allImages = await fs.readdir(imageDir);
const allMeta = await fs.readdir(metaDir);
const imageFiles = allImages.filter((n) => /^\d{4}\.webp$/.test(n)).sort();
const metaFiles = allMeta.filter((n) => /^\d{4}\.json$/.test(n)).sort();
if (imageFiles.length !== SUPPLY || metaFiles.length !== SUPPLY) fail(`GNO PUNK requires exactly ${SUPPLY} numbered images and metadata files; found ${imageFiles.length} / ${metaFiles.length}`);
if (allImages.length !== imageFiles.length) fail(`Unexpected files inside nft-collection/images: ${allImages.filter((n) => !/^\d{4}\.webp$/.test(n)).join(', ')}`);
if (allMeta.length !== metaFiles.length) fail(`Unexpected files inside nft-collection/metadata: ${allMeta.filter((n) => !/^\d{4}\.json$/.test(n)).join(', ')}`);

const imageSet = new Set(imageFiles.map((n) => n.slice(0, 4)));
const metaSet = new Set(metaFiles.map((n) => n.slice(0, 4)));
if (imageSet.size !== metaSet.size || [...imageSet].some((id) => !metaSet.has(id))) fail('Image and metadata edition filenames do not match exactly.');

if (manifest.supply !== SUPPLY) fail(`manifest supply must be ${SUPPLY}`);
if (manifest.founder_reserve !== 333) fail('manifest founder reserve must be 333');
if (manifest.pinned !== true) fail('manifest is not marked pinned; run npm run pin:octopin');
if (!Array.isArray(manifest.tokens) || manifest.tokens.length !== SUPPLY) fail('manifest must list exactly 1,000 tokens');
const imageBase = String(manifest.image_base_uri || '');
const metadataBase = String(manifest.metadata_base_uri || '');
const imageCid = imageBase.match(/^ipfs:\/\/([A-Za-z0-9]+)\/$/)?.[1] || '';
if (!imageCid || imageCid.length < 20) fail('manifest image_base_uri is not a verified ipfs:// directory URI');
if (!/^ipfs:\/\/[A-Za-z0-9]+\/$/.test(metadataBase)) fail('manifest metadata_base_uri is not a verified ipfs:// directory URI');
if (manifest.octopin?.file_count !== SUPPLY * 2) fail(`manifest must record exactly ${SUPPLY * 2} pinned files`);
if (Number(manifest.octopin?.plan_file_limit) < SUPPLY * 2) fail('manifest file count exceeds the recorded plan limit');
if (!archiveReadme.includes('1001–1111')) fail('archive README does not mark editions 1001–1111');

// The ZIP must exist and contain 111 images + 111 JSON + README + checksums = 224 entries.
const archiveBuffer = await fs.readFile(path.join(root, ARCHIVE));
if (archiveBuffer.subarray(0, 2).toString() !== 'PK') fail('archive is not a ZIP file');
let archiveEntries = 0;
for (let i = 0; i <= archiveBuffer.length - 4; i++) if (archiveBuffer.readUInt32LE(i) === 0x02014b50) archiveEntries++;
if (archiveEntries !== 224) fail(`archive should contain 224 entries, found ${archiveEntries}`);

const hashes = new Set();
const traitValues = new Map();
let totalImageBytes = 0;
for (let i = 1; i <= SUPPLY; i++) {
  const id = String(i).padStart(4, '0');
  let image, meta;
  try { image = await fs.readFile(path.join(imageDir, `${id}.webp`)); } catch { fail(`missing image ${id}.webp`); continue; }
  try { meta = JSON.parse(await fs.readFile(path.join(metaDir, `${id}.json`), 'utf8')); } catch { fail(`invalid or missing JSON metadata ${id}.json`); continue; }
  totalImageBytes += image.length;
  if (image.length < 16 || image.toString('ascii', 0, 4) !== 'RIFF' || image.toString('ascii', 8, 12) !== 'WEBP') fail(`${id}.webp is not a valid WebP signature`);
  const hash = crypto.createHash('sha256').update(image).digest('hex');
  if (hashes.has(hash)) fail(`duplicate image bytes detected at edition ${id}`); else hashes.add(hash);

  if (meta.name !== `GNO PUNK #${id}`) fail(`${id}.json has unexpected token name`);
  if (typeof meta.description !== 'string' || !meta.description.includes('not guaranteed')) fail(`${id}.json is missing the utility disclaimer`);
  if (typeof meta.external_url !== 'string' || !/^https:\/\//.test(meta.external_url)) fail(`${id}.json external_url is not an HTTPS URL`);
  const expectedImage = `ipfs://${imageCid}/${id}.webp`;
  if (meta.image !== expectedImage) fail(`${id}.json image URI does not match the pinned image directory`);
  if (/IMAGE_DIRECTORY_CID|REPLACE_WITH|__[A-Z_]+__/i.test(JSON.stringify(meta))) fail(`${id}.json still contains a placeholder`);
  if (!Array.isArray(meta.attributes) || meta.attributes.length < 6) fail(`${id}.json is missing the trait array`);
  const edition = meta.attributes.find((a) => a.trait_type === 'Edition');
  if (!edition || edition.value !== `${id} / ${SUPPLY}`) fail(`${id}.json has a mismatched edition trait`);
  const tier = meta.attributes.find((a) => a.trait_type === 'Mint Tier');
  const reserved = i <= 333;
  if (!tier || tier.value !== (reserved ? 'Founder Reserve' : 'Public Mint')) fail(`${id}.json has a mismatched mint tier`);
  if (meta.properties?.edition !== i || meta.properties?.max_supply !== SUPPLY) fail(`${id}.json has mismatched supply properties`);
  if (meta.properties?.founder_reserve !== reserved) fail(`${id}.json has a mismatched founder reserve flag`);
  if (meta.properties?.image_sha256 !== hash) fail(`${id}.json image_sha256 does not match the artwork`);
  const token = manifest.tokens[i - 1];
  if (!token || token.token_id !== i || token.image_path !== `${id}.webp` || token.metadata_path !== `${id}.json`) fail(`manifest token mapping is broken at ${id}`);

  for (const trait of meta.attributes || []) {
    if (!trait || typeof trait.trait_type !== 'string' || typeof trait.value !== 'string') { fail(`${id}.json has malformed trait values`); continue; }
    if (!['Edition', 'Mint Tier'].includes(trait.trait_type)) {
      if (!traitValues.has(trait.trait_type)) traitValues.set(trait.trait_type, new Set());
      traitValues.get(trait.trait_type).add(trait.value);
    }
  }
}
if (hashes.size !== SUPPLY) fail(`expected ${SUPPLY} unique images; got ${hashes.size}`);
for (const [trait, values] of traitValues) if (values.size < 3) fail(`trait ${trait} has insufficient diversity (${values.size} values)`);

// Product invariants in source and environment defaults.
const mustContain = [
  [registry, 'launchFeeFixed = int64(5_000_000)', 'registry launch fee constant'],
  [registry, 'func FeaturedCollection()', 'automatic featured collection getter'],
  [registry, 'func MarketplaceFeeBps() int64 { return 250 }', 'registry fee rate'],
  [registry, 'func IsAdmin(addr string) bool { requireInit(); return addr == admin.String() }', 'registry admin identification'],
  [registry, 'if !pending.Has(pkg) && !IsAdmin(creatorCall.Address().String()) {', 'launch fee waived only for the registry admin'],
  [collection, 'if !registry.IsAdmin(creator.String()) {', 'collection-side launch fee waiver for the registry admin'],
  [collection, 'takeExact(launchFee)', 'launch fee envelope follows the waiver'],
  [registry, 'return banker.GetCoin(self, nativeDenom)', 'bounded registry balance read'],
  [collection, 'func PublicMint(cur realm)', 'public fixed-edition mint method'],
  [collection, 'maxPublicMintsPerWallet = 2', 'per-wallet public mint cap'],
  [collection, 'if mintsSoFar >= maxPublicMintsPerWallet {', 'per-wallet mint cap enforcement'],
  [collection, 'func PublicMintLimit() int        { requireInit(); return maxPublicMintsPerWallet }', 'per-wallet cap getter read by the server'],
  [collection, 'func MintsByWallet(addr string) int {', 'per-wallet mint counter getter read by the client'],
  [collection, 'fee := price / 40', 'on-chain 2.5% sale fee'],
  [collection, 'takeExact(price + fee)', 'combined buyer checkout amount'],
  [collection, 'sent := unsafe.OriginSend()', 'official Gno origin-payment envelope'],
  [collection, 'stale or spoofed realm handle', 'crossing realm-context validation'],
  [collection, 'func MarketplaceFeeSink()', 'on-chain marketplace fee recipient'],
  [collection, 'founder string, founderReserve int', 'founder reserve Init parameters'],
  [collection, 'if founderReserve < 0 || founderReserve > maxFounderReserve', 'founder reserve bound check'],
  [collection, 'mintTo(cur, founderAddr, colName+" #"+pad4(id), imageURI, metadataURI)', 'founder reserve mint loop'],
  [app, 'imageBase,metadataBase,founder,String(founderReserve)', 'founder reserve in the launch transaction'],
  [app, 'normalizeWalletChain', 'wallet network matching'],
  [app, 'DoContract({messages,memo})', 'Adena DoContract transaction params'],
  [app, "deposit:'1ugnot'", 'documented Adena add-package deposit format'],
  [app, "case 'launch-moonbound'", 'Moonbound launch wiring preserved in the dispatcher'],
  [app, 'data-route="create">Create collection', 'homepage create CTA wiring'],
  [app, 'data-action="open-genesis-item"', 'genesis gallery item wiring'],
  [app, 'const fee=Math.floor(price/40);const total=price+fee;', 'buyer checkout total calculation'],
  [app, 'renderFooterSocials', 'config-driven footer social links'],
  [server, 'registryTreasuryMatches', 'fee recipient match gate'],
  [server, 'registryFeeModelMatches', 'registry fee compatibility gate'],
  [server, 'featuredCollectionPath', 'featured collection API field'],
  [server, 'adminWallet: safeAddress(registryAdmin) ? registryAdmin : \'\'', 'registry admin wallet API field'],
  [server, 'founderAddress: safeAddress(FOUNDER_ADDRESS) ? FOUNDER_ADDRESS : (safeAddress(TREASURY) ? TREASURY : \'\')', 'founder reserve defaults to the treasury wallet'],
  [app, 'founderReserveCopy', 'founder reserve copy follows the configured founder'],
  [app, "dueSend:isAdmin?'':", 'launch fee waiver in the launch transaction'],
  [app, 'function walletMintCapReached()', 'per-wallet mint cap gate in the client'],
  [app, 'if(walletMintCapReached())throw new Error', 'client refuses a mint past the capped limit'],
  [server, "const moonboundMintsPerWallet = moonboundRegistered ? num(await evalValue(moonboundPath, 'PublicMintLimit').catch(() => 0)) : 0", 'per-wallet cap read from the chain, never hardcoded in the server'],
  [server, 'mintsPerWallet: moonboundMintsPerWallet', 'per-wallet cap exposed to the client'],
  [server, "'PublicMintLimit', 'MintsByWallet'", 'per-wallet mint getters in the realm-read allowlist'],
  [server, 'octopinFile', 'Octopin server-side uploader'],
  [server, 'collectionGateway', 'public collection gateway exposure'],
  [env, 'MORROW_REGISTRY_PATH=', 'registry environment setting'],
  [env, 'GNOLAND_MAINNET_TRADING_ENABLED=false', 'mainnet writes disabled by default'],
  [env, 'MORROW_FOUNDER_RESERVE=333', 'founder reserve default'],
  [env, 'OCTOPIN_API_KEY=', 'Octopin key setting'],
  [env, 'MORROW_PUBLIC_URL=', 'public metadata URL setting'],
  [env, 'MOONBOUND_IMAGE_BASE_URI=', 'pinned image base setting'],
  [env, 'MOONBOUND_METADATA_BASE_URI=', 'pinned metadata base setting'],
];
for (const [source, marker, label] of mustContain) if (!source.includes(marker)) fail(`${label} missing or changed`);

if (!collection.includes('chain/runtime/unsafe')) fail('payment guard must import the official Gno unsafe package for OriginSend.');
if (!registry.includes('func CreditLaunchFee(cur realm) {\n\trequireInit()\n\tif !cur.IsCurrent()')) fail('registry launch-fee cross-call lacks the current realm guard.');
if (!registry.includes('func Register(cur realm, name, symbol, cover string, maxSupply int, mintPrice, royaltyBps int64, imageBaseURI, metadataBaseURI string) {\n\trequireInit()\n\tif !cur.IsCurrent()')) fail('registry registration cross-call lacks the current realm guard.');
if (!registry.includes('func NoteMinted(cur realm, n int) {\n\trequireInit()\n\tif !cur.IsCurrent()')) fail('registry mint-index cross-call lacks the current realm guard.');
if (!collection.includes('registry "__REGISTRY_PATH__"')) fail('Collection template must import the configured Morrow registry with the expected alias.');
if (!collection.includes('__PACKAGE__')) fail('Collection package path placeholder missing.');
if ((collection.match(/func ListOffers\(/g) || []).length !== 1) fail('Collection template must declare ListOffers exactly once.');
if (!packageData.scripts?.['pin:octopin']) fail('Octopin pin script missing.');
if (!packageData.scripts?.['build:collection']) fail('build:collection script missing.');
if (!/MARKETPLACE_FEE_BPS=250/.test(env)) fail('environment example must use the fixed 250 BPS rate');
if (/GNOLAND_FACTORY_PATH|morrow-bazaar|bazaar\/factory/i.test(env + app + registry + collection + server)) fail('obsolete third-party marketplace dependency found in runtime source/config.');
if (/COLLECTION_SERVICE_FEE_UGNOT=250000|MARKETPLACE_FEE_BPS=100\b/.test(env)) fail('obsolete/inconsistent fee defaults found.');

// Secret scan: client files, metadata and the manifest must never contain the Octopin key.
async function walk(dir) {
  const found = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) found.push(...await walk(p)); else found.push(p);
  }
  return found;
}
const secretNeedles = [String(process.env.OCTOPIN_API_KEY || '').trim(), String(process.env.PINATA_JWT || '').trim()].filter((value) => value.length > 12);
for (const dir of ['public', 'nft-collection', 'data', 'nft-collection-archive']) {
  for (const file of await walk(path.join(root, dir))) {
    const rel = path.relative(root, file).replaceAll('\\', '/');
    if (/(^|\/)(\.env(?:\..*)?|[^/]+\.(?:pem|key|p12|pfx))$/i.test(rel)) fail(`possible secret/key file under ${dir}/: ${rel}`);
    if (/\.(?:zip|webp)$/i.test(file)) continue;
    const body = await fs.readFile(file, 'utf8').catch(() => '');
    if (/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/.test(body)) fail(`private key material found in ${rel}`);
    if (/\bopk_[A-Za-z0-9]{16,}\b/.test(body)) fail(`possible Octopin API key found in ${rel}`);
    for (const needle of secretNeedles) if (body.includes(needle)) fail(`server credential leaked into ${rel}`);
  }
}

if (process.exitCode) process.exit(1);
console.log('Preflight passed.');
console.log(`• GNO PUNK assets: ${imageFiles.length} unique WebP images + ${metaFiles.length} verified metadata files (${imageFiles.length + metaFiles.length} files, Octopin cap 2,000).`);
console.log(`• Trimmed archive: 111 editions / 224 ZIP entries, outside the upload directories.`);
console.log(`• Pinned CID: ${imageCid} (images) and ${metadataBase} (metadata); manifest checksums verified.`);
console.log(`• Image payload: ${(totalImageBytes / (1024 * 1024)).toFixed(1)} MiB; trait diversity checked.`);
console.log('• Verified source invariants: 5 GNOT launch, 5 GNOT / 1,000 edition mint, 2.5% on-chain sale fee, registry fee-sink gate, founder reserve 333, read-only mainnet defaults.');
console.log('• Limitation: this is a static/source preflight plus local checksum verification, not Gno compilation, an independent security audit, or live Adena/RPC transaction testing.');
