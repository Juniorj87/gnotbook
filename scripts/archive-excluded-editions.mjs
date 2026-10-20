#!/usr/bin/env node
/**
 * Archive the editions that do not fit the Octopin Free file cap.
 *
 * The published collection is 1,000 editions (1,000 images + 1,000 JSON =
 * 2,000 files). Editions 1001-1111 stay in the repository as a clearly marked
 * archive instead of being silently deleted or uploaded past the plan limit.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'nft-collection-unused');
const OUT_DIR = path.join(ROOT, 'nft-collection-archive');
const OUT_ZIP = path.join(OUT_DIR, 'editions-1001-1111.zip');

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

function dosTime(date) {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f);
  const day = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);
  return { time, day };
}

async function buildZip(files, now = new Date()) {
  const { time, day } = dosTime(now);
  const local = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = file.data;
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const checksum = crc32(data);
    const useDeflate = compressed.length < data.length;
    const payload = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(day, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(payload.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, name, payload);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(method, 10);
    record.writeUInt16LE(time, 12);
    record.writeUInt16LE(day, 14);
    record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(payload.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt16LE(0, 30);
    record.writeUInt16LE(0, 32);
    record.writeUInt16LE(0, 34);
    record.writeUInt16LE(0, 36);
    record.writeUInt32LE(0, 38);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += header.length + name.length + payload.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuffer, end]);
}

async function main() {
  const imageDir = path.join(SOURCE, 'images');
  const metaDir = path.join(SOURCE, 'metadata');
  const images = (await fs.readdir(imageDir)).filter((name) => /^\d{4}\.webp$/.test(name)).sort();
  const metadata = (await fs.readdir(metaDir)).filter((name) => /^\d{4}\.json$/.test(name)).sort();
  if (images.length !== 111 || metadata.length !== 111) {
    throw new Error(`Expected 111 archived images and 111 JSON files, found ${images.length}/${metadata.length}.`);
  }
  if (images.map((name) => name.slice(0, 4)).join() !== metadata.map((name) => name.slice(0, 4)).join()) {
    throw new Error('Archived image and metadata editions do not match.');
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  const checksums = [];
  const files = [];
  for (let index = 0; index < images.length; index++) {
    const id = images[index].slice(0, 4);
    const image = await fs.readFile(path.join(imageDir, images[index]));
    const meta = await fs.readFile(path.join(metaDir, metadata[index]));
    files.push({ name: `images/${id}.webp`, data: image });
    files.push({ name: `metadata/${id}.json`, data: meta });
    checksums.push({
      edition: Number(id),
      image: `images/${id}.webp`,
      image_sha256: crypto.createHash('sha256').update(image).digest('hex'),
      metadata: `metadata/${id}.json`,
      metadata_sha256: crypto.createHash('sha256').update(meta).digest('hex'),
    });
  }

  const readme = [
    'GNO PUNK — editions 1001-1111 (archive)',
    '',
    'These 111 editions are NOT part of the published 1,000-edition collection.',
    'They are kept here because the current Octopin Free plan allows 2,000 files,',
    'and the published drop already uses exactly 2,000 files (1,000 images + 1,000 JSON).',
    '',
    'Do not upload this archive to the collection directories. To publish a larger',
    'collection, upgrade Octopin (Hobby and above allow 50,000 files), rebuild the',
    'metadata with `node scripts/build-collection.mjs`, and keep the archive outside',
    'the deployed `nft-collection` folder.',
    '',
    `Archive created: ${new Date().toISOString()}`,
    '',
  ].join('\r\n');
  files.push({ name: 'README.txt', data: Buffer.from(readme, 'utf8') });
  files.push({ name: 'checksums.json', data: Buffer.from(`${JSON.stringify(checksums, null, 2)}\n`, 'utf8') });

  await fs.writeFile(OUT_ZIP, await buildZip(files));
  await fs.writeFile(path.join(OUT_DIR, 'README.md'), [
    '# GNO PUNK archive — editions 1001–1111',
    '',
    '`editions-1001-1111.zip` contains the 111 editions excluded from the published',
    'collection to stay inside the Octopin Free plan limit of 2,000 files.',
    '',
    '- Published collection: 1,000 editions, 2,000 files (images + metadata).',
    '- Archived editions: 1001–1111, 222 files, kept in the ZIP only.',
    '- The ZIP is outside `nft-collection/` and is never uploaded by `npm run pin:octopin`.',
    '',
    'Upgrade the Octopin plan and rebuild before publishing a 1,111-edition drop.',
    '',
  ].join('\n'));
  console.log(`Archive: ${path.relative(ROOT, OUT_ZIP)} (${files.length} entries, ${checksums.length} editions).`);
}

main().catch((error) => {
  console.error(`Archive failed: ${error.message}`);
  process.exit(1);
});
