#!/usr/bin/env node
/**
 * Build the canonical GNO PUNK metadata set from the bundled artwork.
 *
 * The collection is capped at 1,000 editions because the current Octopin plan
 * allows 2,000 files and the drop needs two files per edition (image + JSON).
 * Editions 1001-1111 are archived outside the published collection.
 *
 * Usage:
 *   node scripts/build-collection.mjs --image-cid=...  # verified Octopin directory CID
 *   npm run pin:octopin                                # upload, then rebuild automatically
 *
 * The script is deterministic: traits are derived from the SHA-256 digest of
 * each artwork file, so rebuilding never reshuffles a token.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SUPPLY = 1000;
export const FOUNDER_RESERVE = 333;
export const SCHEMA = 'morrow-nft-v1';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.join(ROOT, 'nft-collection');
const IMAGE_DIR = path.join(PACK, 'images');
const META_DIR = path.join(PACK, 'metadata');
const PUBLIC_URL = (process.env.MORROW_PUBLIC_URL || 'https://gno.land/').trim();

const ARCHETYPES = ['GNO PUNK', 'CHAIN GHOST', 'BYTE REBEL', 'REALM RUNNER', 'NULL NOMAD', 'BLOCK RAT', 'MEMPOOL KID', 'GENESIS OUTLAW'];
const HAIR = ['Hood', 'Long', 'Spikes', 'Flat', 'Bald', 'Cap', 'Horns', 'Mohawk'];
const ACCESSORIES = ['Bandana', 'Earrings', 'Mono-Eye', 'Glasses', 'None', 'Mask', 'Visor'];
const REALMS = ['Akashic', 'Onyx', 'Terran', 'Cosmos', 'Neon', 'Archive', 'Foundry', 'Genesis', 'Void', 'Citadel'];
const RARITIES = [
  ['Common', 539],
  ['Uncommon', 270],
  ['Rare', 134],
  ['Legendary', 43],
  ['Mythic', 14],
];

const pad = (id) => String(id).padStart(4, '0');

function imageCidFromArgs() {
  const arg = process.argv.find((value) => value.startsWith('--image-cid='));
  return (arg ? arg.slice('--image-cid='.length) : process.env.GNO_PUNK_IMAGE_CID || '').trim();
}

function spread(values, total) {
  // Every listed value appears the same number of times; the remainder goes to
  // the first values so the total always matches the token supply exactly.
  const base = Math.floor(total / values.length);
  const rest = total % values.length;
  const out = [];
  values.forEach((value, index) => out.push(...Array(base + (index < rest ? 1 : 0)).fill(value)));
  return out;
}

function weighted(values, total) {
  return values.flatMap(([value, count]) => Array(count).fill(value));
}

function isValidCid(value) {
  return /^[A-Za-z0-9]+$/.test(value) && value.length >= 20;
}

export async function buildCollection({ imageCid = imageCidFromArgs(), log = console.log } = {}) {
  if (!isValidCid(imageCid)) {
    throw new Error('An uploaded image directory CID is required. Run npm run pin:octopin, or pass --image-cid=<cid>. Metadata is never written with a placeholder.');
  }
  const cid = imageCid;

  await fs.mkdir(META_DIR, { recursive: true });
  const imageFiles = (await fs.readdir(IMAGE_DIR)).filter((name) => /^\d{4}\.webp$/.test(name)).sort();
  if (imageFiles.length !== SUPPLY) {
    throw new Error(`Expected exactly ${SUPPLY} images in ${path.relative(ROOT, IMAGE_DIR)}, found ${imageFiles.length}.`);
  }

  const entries = [];
  const imageHashes = new Set();
  for (let edition = 1; edition <= SUPPLY; edition++) {
    const id = pad(edition);
    const file = path.join(IMAGE_DIR, `${id}.webp`);
    const bytes = await fs.readFile(file);
    if (bytes.length < 16 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') {
      throw new Error(`${id}.webp is not a valid WebP file.`);
    }
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    if (imageHashes.has(sha256)) throw new Error(`Duplicate artwork bytes at edition ${id}.`);
    imageHashes.add(sha256);
    entries.push({ edition, id, bytes: bytes.length, sha256 });
  }

  // Order tokens by artwork digest so trait assignment is independent of the
  // file numbering and stays stable if the collection is rebuilt.
  const ranked = [...entries].sort((a, b) => a.sha256.localeCompare(b.sha256));
  const archetypes = spread(ARCHETYPES, SUPPLY);
  const hair = spread(HAIR, SUPPLY);
  const accessories = spread(ACCESSORIES, SUPPLY);
  const realms = spread(REALMS, SUPPLY);
  const rarities = weighted(RARITIES, SUPPLY);
  if (rarities.length !== SUPPLY) throw new Error('Rarity table does not match the supply.');

  ranked.forEach((entry, index) => {
    entry.archetype = archetypes[index];
    entry.hair = hair[index];
    entry.accessory = accessories[index];
    entry.realm = realms[index];
    entry.rarity = rarities[index];
  });

  const manifestTokens = [];
  for (const entry of entries) {
    const reserved = entry.edition <= FOUNDER_RESERVE;
    const description = reserved
      ? `GNO PUNK is a ${SUPPLY.toLocaleString('en-US')}-piece pixel-art identity collection native to the Gno.land ecosystem. Edition #${entry.id} belongs to the ${FOUNDER_RESERVE}-edition founder reserve. Ownership and rarity are collectible metadata only; future value or utility is not guaranteed.`
      : `GNO PUNK is a ${SUPPLY.toLocaleString('en-US')}-piece pixel-art identity collection native to the Gno.land ecosystem. Edition #${entry.id} is part of the public run (editions #${pad(FOUNDER_RESERVE + 1)}–#${pad(SUPPLY)}). Ownership and rarity are collectible metadata only; future value or utility is not guaranteed.`;
    const metadata = {
      name: `GNO PUNK #${entry.id}`,
      description,
      image: `ipfs://${cid}/${entry.id}.webp`,
      external_url: PUBLIC_URL,
      attributes: [
        { trait_type: 'Archetype', value: entry.archetype },
        { trait_type: 'Realm', value: entry.realm },
        { trait_type: 'Rarity', value: entry.rarity },
        { trait_type: 'Hair', value: entry.hair },
        { trait_type: 'Accessory', value: entry.accessory },
        { trait_type: 'Edition', value: `${entry.id} / ${SUPPLY}` },
        { trait_type: 'Mint Tier', value: reserved ? 'Founder Reserve' : 'Public Mint' },
      ],
      properties: {
        edition: entry.edition,
        max_supply: SUPPLY,
        founder_reserve: reserved,
        mint_policy: reserved ? 'founder-reserve' : 'public-mint',
        image_sha256: entry.sha256,
        schema: SCHEMA,
      },
    };
    const metaBytes = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    await fs.writeFile(path.join(META_DIR, `${entry.id}.json`), metaBytes);
    manifestTokens.push({
      token_id: entry.edition,
      name: metadata.name,
      metadata_path: `${entry.id}.json`,
      image_path: `${entry.id}.webp`,
      image_sha256: entry.sha256,
      metadata_sha256: crypto.createHash('sha256').update(metaBytes).digest('hex'),
      attributes: metadata.attributes,
    });
  }

  const manifestPath = path.join(ROOT, 'data', 'collection-manifest.json');
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  const manifest = {
    collection: 'GNO PUNK',
    symbol: 'GNP',
    schema: SCHEMA,
    supply: SUPPLY,
    founder_reserve: FOUNDER_RESERVE,
    image_base_uri: `ipfs://${cid}/`,
    metadata_base_uri: '',
    external_url: PUBLIC_URL,
    pinned: true,
    built_at: new Date().toISOString(),
    tokens: manifestTokens,
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  log(`Built ${SUPPLY} metadata files (reserve ${FOUNDER_RESERVE}, image CID ${cid}).`);
  log(`Manifest: ${path.relative(ROOT, manifestPath)}`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildCollection().catch((error) => {
    console.error(`Collection build failed: ${error.message}`);
    process.exit(1);
  });
}
