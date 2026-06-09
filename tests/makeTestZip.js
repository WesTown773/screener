'use strict';

/**
 * Build a tiny in-memory zip for ingest tests.
 * Uses Node's built-in zlib (deflate) + manual ZIP format — no dependencies.
 *
 * Returns a Buffer containing a valid ZIP file with the supplied entries.
 * Each entry: { name, data } where data is a string or Buffer.
 */

const zlib = require('zlib');

function uint32LE(n) {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}
function uint16LE(n) {
  const b = Buffer.allocUnsafe(2);
  b.writeUInt16LE(n & 0xffff, 0);
  return b;
}
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(entries) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const compressed = zlib.deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(raw);
    const date = 0x5260; // 2023-03-00 — arbitrary
    const time = 0x0000;

    // Local file header (signature 0x04034b50)
    const local = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      uint16LE(20),        // version needed
      uint16LE(0),         // flags
      uint16LE(8),         // compression: deflate
      uint16LE(time),
      uint16LE(date),
      uint32LE(crc),
      uint32LE(compressed.length),
      uint32LE(raw.length),
      uint16LE(nameBuf.length),
      uint16LE(0),         // extra length
      nameBuf,
      compressed,
    ]);

    localHeaders.push(local);

    // Central directory header (signature 0x02014b50)
    const central = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x01, 0x02]),
      uint16LE(20),        // version made by
      uint16LE(20),        // version needed
      uint16LE(0),         // flags
      uint16LE(8),         // compression
      uint16LE(time),
      uint16LE(date),
      uint32LE(crc),
      uint32LE(compressed.length),
      uint32LE(raw.length),
      uint16LE(nameBuf.length),
      uint16LE(0),         // extra length
      uint16LE(0),         // comment length
      uint16LE(0),         // disk number start
      uint16LE(0),         // internal attributes
      uint32LE(0),         // external attributes
      uint32LE(offset),    // relative offset of local header
      nameBuf,
    ]);

    centralHeaders.push(central);
    offset += local.length;
  }

  const centralStart = offset;
  const centralBuf = Buffer.concat(centralHeaders);

  // End of central directory (signature 0x06054b50)
  const eocd = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    uint16LE(0),                       // disk number
    uint16LE(0),                       // disk with start of CD
    uint16LE(entries.length),          // entries on this disk
    uint16LE(entries.length),          // total entries
    uint32LE(centralBuf.length),
    uint32LE(centralStart),
    uint16LE(0),                       // comment length
  ]);

  return Buffer.concat([...localHeaders, centralBuf, eocd]);
}

module.exports = { buildZip };
