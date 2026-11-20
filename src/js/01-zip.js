// Zip files: Word documents are zips, and projects travel between devices as zips through the Files app
// (iCloud Drive, Google Drive, AirDrop). Reads zips made by MCdng, Word and the Finder's Compress (stored or
// deflated entries, UTF-8 names), and writes zips with texts deflated and PDFs and Word files stored, since
// they are compressed already.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function throughStream(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

const Zip = {
  // files: [{ path, data }] with data a Uint8Array or a Blob. Resolves with a Blob.
  async write(files) {
    const parts = [], central = [];
    let offset = 0;
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const file of files) {
      const raw = file.data instanceof Blob ? new Uint8Array(await file.data.arrayBuffer()) : file.data;
      const name = new TextEncoder().encode(file.path);
      const deflate = /\.(json|txt|md)$/i.test(file.path) && typeof CompressionStream === 'function';
      const data = deflate ? await throughStream(raw, new CompressionStream('deflate-raw')) : raw;
      const crc = crc32(raw);
      const header = (signature, size) => {
        const view = new DataView(new ArrayBuffer(size));
        view.setUint32(0, signature, true);
        return view;
      };
      const local = header(0x04034b50, 30);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // names in UTF-8
      local.setUint16(8, deflate ? 8 : 0, true);
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, raw.length, true);
      local.setUint16(26, name.length, true);
      parts.push(local.buffer, name, data);
      const entry = header(0x02014b50, 46);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(10, deflate ? 8 : 0, true);
      entry.setUint16(12, time, true);
      entry.setUint16(14, date, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, data.length, true);
      entry.setUint32(24, raw.length, true);
      entry.setUint16(28, name.length, true);
      entry.setUint32(42, offset, true);
      central.push(entry.buffer, name);
      offset += 30 + name.length + data.length;
    }
    const size = central.reduce((sum, part) => sum + part.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, size, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
  },

  // Resolves with a Map of path → Uint8Array for the files of a zip (folders and the Finder's __MACOSX and
  // .DS_Store left out). Entries are read one at a time, so a large zip is never all in memory twice.
  async read(blob) {
    const tail = new DataView(await blob.slice(Math.max(0, blob.size - 65557)).arrayBuffer());
    let at = tail.byteLength - 22;
    while (at >= 0 && tail.getUint32(at, true) !== 0x06054b50) at--;
    if (at < 0) throw new Error('This file is not a zip.');
    const count = tail.getUint16(at + 10, true);
    const cdSize = tail.getUint32(at + 12, true);
    const cdOffset = tail.getUint32(at + 16, true);
    if (cdOffset === 0xffffffff) throw new Error('This zip is too large to open here.');
    const cd = new DataView(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
    const files = new Map();
    for (let i = 0, p = 0; i < count; i++) {
      if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('This zip is damaged.');
      const method = cd.getUint16(p + 10, true);
      const csize = cd.getUint32(p + 20, true);
      const nameLength = cd.getUint16(p + 28, true);
      const extra = cd.getUint16(p + 30, true);
      const comment = cd.getUint16(p + 32, true);
      const offset = cd.getUint32(p + 42, true);
      const path = new TextDecoder().decode(new Uint8Array(cd.buffer, p + 46, nameLength));
      p += 46 + nameLength + extra + comment;
      if (path.endsWith('/') || /(^|\/)(__MACOSX|\.DS_Store)(\/|$)/.test(path)) continue;
      if (method !== 0 && method !== 8) throw new Error(`${path} is compressed in a way MCdng cannot read.`);
      const local = new DataView(await blob.slice(offset, offset + 30).arrayBuffer());
      const start = offset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
      const data = new Uint8Array(await blob.slice(start, start + csize).arrayBuffer());
      files.set(path, method === 8 ? await throughStream(data, new DecompressionStream('deflate-raw')) : data);
    }
    return files;
  },
};
