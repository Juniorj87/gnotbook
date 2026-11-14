/* Morrow artist pack builder — runs entirely in the artist's browser.
 * It prepares two portable folder ZIPs; it never sends artwork or IPFS keys to this server.
 */
(() => {
  'use strict';
  const MAX_FILES = 1000;
  const MAX_FILE_BYTES = 15 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 150 * 1024 * 1024;
  const MAX_PIXELS = 40_000_000;
  const encoder = new TextEncoder();

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function u16(view, offset, value) { view.setUint16(offset, value, true); }
  function u32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }
  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    return { time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate() };
  }
  async function makeZip(entries) {
    if (!Array.isArray(entries) || !entries.length) throw new Error('There are no files to package.');
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const stamp = dosDateTime();
    for (const entry of entries) {
      const name = encoder.encode(String(entry.name).replace(/^\/+/, '').replace(/\\/g, '/'));
      if (!name.length || name.length > 65535) throw new Error('A file name is invalid or too long.');
      const bytes = entry.data instanceof Blob ? new Uint8Array(await entry.data.arrayBuffer())
        : entry.data instanceof Uint8Array ? entry.data : encoder.encode(String(entry.data ?? ''));
      const crc = crc32(bytes);
      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      u32(lv, 0, 0x04034B50); u16(lv, 4, 20); u16(lv, 6, 0x0800); u16(lv, 8, 0);
      u16(lv, 10, stamp.time); u16(lv, 12, stamp.date); u32(lv, 14, crc);
      u32(lv, 18, bytes.length); u32(lv, 22, bytes.length); u16(lv, 26, name.length); u16(lv, 28, 0);
      local.set(name, 30);
      localParts.push(local, bytes);

      const central = new Uint8Array(46 + name.length);
      const cv = new DataView(central.buffer);
      u32(cv, 0, 0x02014B50); u16(cv, 4, 20); u16(cv, 6, 20); u16(cv, 8, 0x0800); u16(cv, 10, 0);
      u16(cv, 12, stamp.time); u16(cv, 14, stamp.date); u32(cv, 16, crc);
      u32(cv, 20, bytes.length); u32(cv, 24, bytes.length); u16(cv, 28, name.length);
      u16(cv, 30, 0); u16(cv, 32, 0); u16(cv, 34, 0); u16(cv, 36, 0); u32(cv, 38, 0); u32(cv, 42, offset);
      central.set(name, 46);
      centralParts.push(central);
      offset += local.length + bytes.length;
    }
    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    u32(ev, 0, 0x06054B50); u16(ev, 4, 0); u16(ev, 6, 0);
    u16(ev, 8, entries.length); u16(ev, 10, entries.length);
    u32(ev, 12, centralSize); u32(ev, 16, offset); u16(ev, 20, 0);
    return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
  }
  function safeText(value, max = 2000) { return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, max); }
  function normaliseOverrides(input) {
    if (!input) return new Map();
    const rows = Array.isArray(input) ? input : Array.isArray(input.editions) ? input.editions
      : Array.isArray(input.items) ? input.items : null;
    if (!rows) throw new Error('Metadata JSON must be an array or contain an editions/items array.');
    if (rows.length > MAX_FILES) throw new Error(`Metadata JSON cannot contain more than ${MAX_FILES} editions.`);
    const byId = new Map();
    rows.forEach((row, index) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Metadata row ${index + 1} must be an object.`);
      const rawId = row.edition ?? row.id ?? row.tokenId ?? (index + 1);
      const id = Number(rawId);
      if (!Number.isInteger(id) || id < 1 || id > MAX_FILES) throw new Error(`Metadata row ${index + 1} has an invalid edition number.`);
      if (byId.has(id)) throw new Error(`Metadata JSON contains duplicate edition ${id}.`);
      const attrs = row.attributes === undefined ? [] : row.attributes;
      if (!Array.isArray(attrs) || attrs.length > 100) throw new Error(`Edition ${id}: attributes must be an array with at most 100 entries.`);
      byId.set(id, {
        name: safeText(row.name, 120), description: safeText(row.description, 2000),
        attributes: attrs.map((attr, attrIndex) => {
          if (!attr || typeof attr !== 'object' || !('trait_type' in attr) || !('value' in attr)) throw new Error(`Edition ${id}: attribute ${attrIndex + 1} needs trait_type and value.`);
          return { trait_type: safeText(attr.trait_type, 80), value: typeof attr.value === 'number' ? attr.value : safeText(attr.value, 160) };
        })
      });
    });
    return byId;
  }
  async function prepare(filesInput) {
    const files = [...(filesInput || [])].filter(file => /\.(png|jpe?g|webp)$/i.test(file.name));
    if (!files.length) throw new Error('Choose PNG, JPEG or WebP artwork files.');
    if (files.length > MAX_FILES) throw new Error(`A collection can contain up to ${MAX_FILES} editions per package.`);
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (files.some(file => file.size <= 0 || file.size > MAX_FILE_BYTES)) throw new Error('Each image must be between 1 byte and 15 MB.');
    if (total > MAX_TOTAL_BYTES) throw new Error('The selected source images exceed the 150 MB total limit. Split the collection into smaller batches.');
    files.sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, undefined, { numeric: true, sensitivity: 'base' }));
    const records = [];
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      let bitmap;
      try { bitmap = await createImageBitmap(file); }
      catch { throw new Error(`${file.name} is not a readable image.`); }
      try {
        if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > MAX_PIXELS || bitmap.width > 8000 || bitmap.height > 8000) {
          throw new Error(`${file.name} exceeds the 8,000 px side / 40 MP image limit.`);
        }
        let blob = file;
        if (file.type !== 'image/webp') {
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width; canvas.height = bitmap.height;
          const context = canvas.getContext('2d', { alpha: true });
          if (!context) throw new Error('Your browser could not create an image canvas.');
          context.drawImage(bitmap, 0, 0);
          blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error(`Could not convert ${file.name} to WebP.`)), 'image/webp', 0.92));
          canvas.width = 0; canvas.height = 0;
        }
        records.push({ id: index + 1, sourceName: file.name, fileName: `${String(index + 1).padStart(4, '0')}.webp`, blob, bytes: blob.size, width: bitmap.width, height: bitmap.height });
      } finally { bitmap.close?.(); }
    }
    return records;
  }
  async function imagesZip(records, collectionName) {
    if (!records?.length) throw new Error('Prepare the artwork first.');
    const manifest = { schema: 'morrow-artist-pack/v1', collection: safeText(collectionName, 64), editions: records.length,
      files: records.map(row => ({ edition: row.id, image: `images/${row.fileName}`, bytes: row.bytes, width: row.width, height: row.height })) };
    return makeZip([
      ...records.map(row => ({ name: `images/${row.fileName}`, data: row.blob })),
      { name: 'package-manifest.json', data: JSON.stringify(manifest, null, 2) },
      { name: 'UPLOAD-INSTRUCTIONS.txt', data: 'Extract this ZIP. Upload the images/ directory as a folder to IPFS (wrap it as a directory; do not pin the ZIP file itself). Copy the directory CID. Then generate the metadata package in Morrow using that image directory CID. The public mint creates one numbered edition per on-chain transaction.' }
    ]);
  }
  async function metadataZip(records, options = {}) {
    if (!records?.length) throw new Error('Prepare the artwork first.');
    const baseCid = safeText(options.imageBaseCid, 120).trim().replace(/^ipfs:\/\//i, '').replace(/\/$/, '');
    if (!/^[a-zA-Z0-9]{20,120}$/.test(baseCid)) throw new Error('Enter the image folder CID before generating metadata.');
    const name = safeText(options.name || 'Untitled collection', 64).trim() || 'Untitled collection';
    const description = safeText(options.description, 1000).trim();
    const overrides = options.overrides instanceof Map ? options.overrides : normaliseOverrides(options.overrides);
    const firstImage = `ipfs://${baseCid}/${records[0].fileName}`;
    const rows = records.map(row => {
      const custom = overrides.get(row.id) || {};
      return {
        name: custom.name || `${name} #${String(row.id).padStart(4, '0')}`,
        description: custom.description || description,
        image: `ipfs://${baseCid}/${row.fileName}`,
        edition: row.id,
        attributes: custom.attributes || []
      };
    });
    const collection = { name, description, image: firstImage, seller_fee_basis_points: Number(options.royaltyBps ?? 200) };
    if (options.website && /^https?:\/\//i.test(options.website)) collection.external_link = options.website;
    const manifest = { schema: 'morrow-artist-pack/v1', editions: records.length, imageBaseCid: baseCid,
      metadataFiles: rows.map(row => `metadata/${String(row.edition).padStart(4, '0')}.json`), collectionMetadata: 'metadata/collection.json' };
    const entries = rows.map(row => ({ name: `metadata/${String(row.edition).padStart(4, '0')}.json`, data: JSON.stringify(row, null, 2) }));
    entries.push({ name: 'metadata/collection.json', data: JSON.stringify(collection, null, 2) });
    entries.push({ name: 'metadata/manifest.json', data: JSON.stringify(manifest, null, 2) });
    entries.push({ name: 'UPLOAD-INSTRUCTIONS.txt', data: 'Extract this ZIP and upload the metadata/ directory as a folder to IPFS (wrap it as a directory; do not pin the ZIP file itself). Copy the directory CID. In Morrow, use <metadata-folder-CID>/collection.json as the collection metadata file and the metadata folder CID as the metadata base directory. Verify the first edition before launch.' });
    return makeZip(entries);
  }
  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = filename;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
  window.MorrowArtistPack = { MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES, prepare, imagesZip, metadataZip, normaliseOverrides, download };
})();
