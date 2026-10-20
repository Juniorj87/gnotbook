#!/usr/bin/env node
/**
 * Build the distributable archive.
 *
 * Excluded: node_modules, .git, .env (and variants), .tmp, logs, the local
 * moderation store and previous release ZIPs. Included: source, tests, the
 * 2,000 pinned collection files, the 111-edition archive, manifest and docs.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'morrow-release.zip');
const SKIP_DIRS = new Set(['node_modules', '.git', '.tmp', '.freebuff', 'coverage']);
const SKIP_FILES = [/^\.env$/i, /^\.env\.(local|production|development|test)$/i, /\.log$/i, /^morrow-release\.zip$/i, /^morrowlast\.zip$/i, /^nftmarket\.zip$/i, /^store\.json$/i, /^\.DS_Store$/i, /^приватник/i, /^private[_-]?key/i];

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
const dosTime = (date) => ({
  time: ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f),
  day: (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f),
});

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full).replaceAll('\\', '/');
    // Never follow symlinks: the working folder can be linked to node_modules or secrets.
    // Treating a symlink as a file may cause EISDIR and can leak dependencies into release.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...await walk(full));
    } else if (entry.isFile() && !SKIP_FILES.some((pattern) => pattern.test(entry.name))) {
      out.push({ full, rel });
    }
  }
  return out;
}

async function buildZip(files) {
  const { time, day } = dosTime(new Date());
  const local = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.rel, 'utf8');
    const data = await fs.readFile(file.full);
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = compressed.length < data.length;
    const payload = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;
    const checksum = crc32(data);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
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

const files = (await walk(ROOT)).sort((a, b) => a.rel.localeCompare(b.rel));
if (!files.some((f) => f.rel === 'data/collection-manifest.json')) throw new Error('manifest missing');
if (!files.some((f) => f.rel === 'nft-collection-archive/editions-1001-1111.zip')) throw new Error('archive missing');
if (files.some((f) => /(^|\/)\.env$/.test(f.rel) || /(^|\/)\.env\.(local|production|development|test)$/.test(f.rel))) throw new Error('refusing to package .env');
if (files.length < 2000) throw new Error(`release looks incomplete: ${files.length} files`);

await fs.writeFile(OUT, await buildZip(files));
const size = (await fs.stat(OUT)).size;
console.log(`Release: ${path.basename(OUT)}`);
console.log(`Files: ${files.length.toLocaleString('en-US')}`);
console.log(`Size: ${(size / (1024 * 1024)).toFixed(1)} MiB`);
