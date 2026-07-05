'use strict';

// Single-file project format (.ppx): bundles the original media (audio OR
// audio+video — for a video project the media IS the whole video), the per-song
// settings, and (optionally) the separated stems compressed as Opus, so one file
// restores the whole practice setup on any machine. Self-contained — no external
// zip dependency; media is streamed in/out to stay memory-light.
//
// Layout:
//   [0..4)            magic  "PPX1"
//   [4..8)            uint32 LE  header JSON length (H)
//   [8..8+H)          header JSON (utf8):
//                       { v, media:{ name, size }, settings,
//                         stems?: { codec, sources[], total, sr, blobs:[{name,size}] } }
//   [8+H .. +media)   raw media bytes (exactly media.size)
//   [ .. EOF)         stem blobs, concatenated in `stems.blobs` order (v2 only)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');

const MAGIC = 'PPX1';

// Write mediaPath + settings (+ optional stemPack) into a single .ppx at outPath.
// stemPack: { codec, sources[], total, sr, blobs:[{ name, buffer }] } | null.
async function save(mediaPath, settings, outPath, stemPack) {
  const stat = fs.statSync(mediaPath);
  const stems = stemPack ? {
    codec: stemPack.codec,
    model: stemPack.model,
    sources: stemPack.sources,
    total: stemPack.total,
    sr: stemPack.sr,
    blobs: stemPack.blobs.map((b) => ({ name: b.name, size: b.buffer.length }))
  } : null;

  const header = Buffer.from(JSON.stringify({
    v: 2,
    media: { name: path.basename(mediaPath), size: stat.size },
    settings: settings || {},
    stems
  }), 'utf8');

  const head = Buffer.alloc(8);
  head.write(MAGIC, 0, 'ascii');
  head.writeUInt32LE(header.length, 4);

  const tmp = outPath + '.part';
  const out = fs.createWriteStream(tmp);
  out.write(head);
  out.write(header);
  // Stream the media without closing the stream, then append the stem blobs.
  await new Promise((resolve, reject) => {
    const rs = fs.createReadStream(mediaPath);
    rs.on('error', reject);
    rs.on('end', resolve);
    rs.on('data', (c) => out.write(c));
  });
  if (stemPack) for (const b of stemPack.blobs) out.write(b.buffer);
  await new Promise((resolve, reject) => { out.on('error', reject); out.end(resolve); });
  fs.renameSync(tmp, outPath);
  return outPath;
}

// Read header (magic + JSON) from the start of a .ppx file.
function readHeader(ppxPath) {
  const fd = fs.openSync(ppxPath, 'r');
  try {
    const head = Buffer.alloc(8);
    fs.readSync(fd, head, 0, 8, 0);
    if (head.toString('ascii', 0, 4) !== MAGIC) {
      throw new Error('File di progetto non valido (intestazione mancante).');
    }
    const headerLen = head.readUInt32LE(4);
    const hbuf = Buffer.alloc(headerLen);
    fs.readSync(fd, hbuf, 0, headerLen, 8);
    const meta = JSON.parse(hbuf.toString('utf8'));
    return { meta, mediaOffset: 8 + headerLen };
  } finally {
    fs.closeSync(fd);
  }
}

// Extract the media to a stable folder under extractRoot and return its path +
// settings. The same .ppx always extracts to the same path (keyed by size+mtime),
// so re-opening reuses the file and any stem cache derived from it.
async function load(ppxPath, extractRoot) {
  const { meta, mediaOffset } = readHeader(ppxPath);
  const st = fs.statSync(ppxPath);
  const key = crypto.createHash('sha1')
    .update(`${ppxPath}|${st.size}|${Math.round(st.mtimeMs)}`)
    .digest('hex').slice(0, 16);

  const dir = path.join(extractRoot, key);
  fs.mkdirSync(dir, { recursive: true });
  const mediaPath = path.join(dir, meta.media.name);

  // Re-extract only if missing or the wrong size. Read exactly media.size bytes
  // (the stem blobs, if any, follow the media and must not leak into it).
  const ok = fs.existsSync(mediaPath) && fs.statSync(mediaPath).size === meta.media.size;
  if (!ok) {
    const tmp = mediaPath + '.part';
    await pipeline(
      fs.createReadStream(ppxPath, { start: mediaOffset, end: mediaOffset + meta.media.size - 1 }),
      fs.createWriteStream(tmp)
    );
    fs.renameSync(tmp, mediaPath);
  }

  // Read the embedded stem blobs (v2), if present.
  let stems = null;
  if (meta.stems && Array.isArray(meta.stems.blobs) && meta.stems.blobs.length) {
    const fd = fs.openSync(ppxPath, 'r');
    try {
      let offset = mediaOffset + meta.media.size;
      const blobs = [];
      for (const b of meta.stems.blobs) {
        const buf = Buffer.alloc(b.size);
        fs.readSync(fd, buf, 0, b.size, offset);
        blobs.push({ name: b.name, buffer: buf });
        offset += b.size;
      }
      stems = { codec: meta.stems.codec, model: meta.stems.model, sources: meta.stems.sources, total: meta.stems.total, sr: meta.stems.sr, blobs };
    } finally {
      fs.closeSync(fd);
    }
  }

  return { mediaPath, settings: meta.settings || {}, name: meta.media.name, stems };
}

module.exports = { save, load, readHeader, MAGIC };
