'use strict';

// Single-file project format (.ppx): bundles the original media (audio OR
// audio+video) together with the per-song settings, so one file restores the
// whole practice setup. Self-contained — no external zip dependency (only
// onnxruntime-node is a runtime dep), media is streamed in/out to stay memory-light.
//
// Layout:
//   [0..4)            magic  "PPX1"
//   [4..8)            uint32 LE  header JSON length (H)
//   [8..8+H)          header JSON (utf8): { v, media:{ name, size }, settings }
//   [8+H..EOF)        raw media bytes

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');

const MAGIC = 'PPX1';

// Write mediaPath + settings into a single .ppx at outPath (streamed).
async function save(mediaPath, settings, outPath) {
  const stat = fs.statSync(mediaPath);
  const header = Buffer.from(JSON.stringify({
    v: 1,
    media: { name: path.basename(mediaPath), size: stat.size },
    settings: settings || {}
  }), 'utf8');

  const head = Buffer.alloc(8);
  head.write(MAGIC, 0, 'ascii');
  head.writeUInt32LE(header.length, 4);

  const tmp = outPath + '.part';
  const out = fs.createWriteStream(tmp);
  out.write(head);
  out.write(header);
  await pipeline(fs.createReadStream(mediaPath), out, { end: true });
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

  // Re-extract only if missing or the wrong size.
  const ok = fs.existsSync(mediaPath) && fs.statSync(mediaPath).size === meta.media.size;
  if (!ok) {
    const tmp = mediaPath + '.part';
    await pipeline(
      fs.createReadStream(ppxPath, { start: mediaOffset }),
      fs.createWriteStream(tmp)
    );
    fs.renameSync(tmp, mediaPath);
  }

  return { mediaPath, settings: meta.settings || {}, name: meta.media.name };
}

module.exports = { save, load, readHeader, MAGIC };
