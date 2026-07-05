// Downloads the bundled native tools into bin/ (ffmpeg + yt-dlp).
// These are too large / fast-moving to commit (ffmpeg > GitHub's 100MB per-file
// limit), so CI and fresh local checkouts fetch them here instead. Cross-platform:
// on Windows fetches the .exe builds, on Linux fetches the static Linux builds
// (used by the AppImage). Pass --force to re-download even if a file exists.

import { createWriteStream, existsSync, mkdirSync, rmSync, copyFileSync, chmodSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const FORCE = process.argv.includes('--force');
const IS_WIN = process.platform === 'win32';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binDir = path.join(root, 'bin');
const tmpDir = path.join(root, '.bin-tmp');
mkdirSync(binDir, { recursive: true });

// yt-dlp: standalone Windows .exe / standalone Linux binary (no Python needed).
const YTDLP_URL = IS_WIN
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';

// ffmpeg static builds. Windows: gyan.dev "essentials" zip. Linux: BtbN static
// tarball on GitHub (reliable, no rate limits), contains .../bin/ffmpeg.
const FFMPEG_URL = IS_WIN
  ? 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
  : 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz';

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'PracticePlayer-fetch' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} su ${url}`)); }
      const file = createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
      file.on('error', reject);
    });
    req.on('error', reject);
  });
}

function findFile(dir, name) {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) { const f = findFile(p, name); if (f) return f; }
    else if (entry.toLowerCase() === name) return p;
  }
  return null;
}

// Extract an archive into tmpDir: Expand-Archive (zip) on Windows, tar (xz) on Linux.
function extract(archive) {
  const r = IS_WIN
    ? spawnSync('powershell', ['-NoProfile', '-Command',
        `Expand-Archive -Path "${archive}" -DestinationPath "${tmpDir}" -Force`], { stdio: 'inherit' })
    : spawnSync('tar', ['-xf', archive, '-C', tmpDir], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('Estrazione archivio fallita.');
}

async function main() {
  const ext = IS_WIN ? '.exe' : '';

  // yt-dlp
  const ytdlp = path.join(binDir, 'yt-dlp' + ext);
  if (FORCE || !existsSync(ytdlp)) {
    console.log('Scarico yt-dlp…');
    await download(YTDLP_URL, ytdlp);
    if (!IS_WIN) chmodSync(ytdlp, 0o755);
  } else console.log('yt-dlp già presente.');

  // ffmpeg (from an archive)
  const ffmpeg = path.join(binDir, 'ffmpeg' + ext);
  if (FORCE || !existsSync(ffmpeg)) {
    console.log('Scarico ffmpeg…');
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    const archive = path.join(tmpDir, IS_WIN ? 'ffmpeg.zip' : 'ffmpeg.tar.xz');
    await download(FFMPEG_URL, archive);
    console.log('Estraggo ffmpeg…');
    extract(archive);
    const found = findFile(tmpDir, 'ffmpeg' + ext);
    if (!found) throw new Error('binario ffmpeg non trovato nell\'archivio.');
    copyFileSync(found, ffmpeg);
    if (!IS_WIN) chmodSync(ffmpeg, 0o755);
    rmSync(tmpDir, { recursive: true, force: true });
  } else console.log('ffmpeg già presente.');

  console.log('Binari pronti in bin/.');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
