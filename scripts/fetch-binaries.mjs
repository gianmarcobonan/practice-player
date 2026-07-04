// Downloads the bundled native tools into bin/ (ffmpeg.exe, yt-dlp.exe).
// These are too large / fast-moving to commit (ffmpeg.exe > GitHub's 100MB
// per-file limit), so CI and fresh local checkouts fetch them here instead.
// Windows-only (the app targets Windows); uses PowerShell Expand-Archive for the
// ffmpeg zip. Pass --force to re-download even if a file already exists.

import { createWriteStream, existsSync, mkdirSync, rmSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const FORCE = process.argv.includes('--force');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binDir = path.join(root, 'bin');
const tmpDir = path.join(root, '.bin-tmp');
mkdirSync(binDir, { recursive: true });

const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
// Canonical "latest release, essentials" Windows build (contains bin/ffmpeg.exe).
const FFMPEG_ZIP_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';

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

function findExe(dir, name) {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) { const f = findExe(p, name); if (f) return f; }
    else if (entry.toLowerCase() === name) return p;
  }
  return null;
}

async function main() {
  // yt-dlp.exe
  const ytdlp = path.join(binDir, 'yt-dlp.exe');
  if (FORCE || !existsSync(ytdlp)) {
    console.log('Scarico yt-dlp.exe…');
    await download(YTDLP_URL, ytdlp);
  } else console.log('yt-dlp.exe già presente.');

  // ffmpeg.exe (from a zip)
  const ffmpeg = path.join(binDir, 'ffmpeg.exe');
  if (FORCE || !existsSync(ffmpeg)) {
    console.log('Scarico ffmpeg…');
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    const zip = path.join(tmpDir, 'ffmpeg.zip');
    await download(FFMPEG_ZIP_URL, zip);
    console.log('Estraggo ffmpeg.zip…');
    const r = spawnSync('powershell', ['-NoProfile', '-Command',
      `Expand-Archive -Path "${zip}" -DestinationPath "${tmpDir}" -Force`], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('Estrazione ffmpeg fallita.');
    const found = findExe(tmpDir, 'ffmpeg.exe');
    if (!found) throw new Error('ffmpeg.exe non trovato nello zip.');
    copyFileSync(found, ffmpeg);
    rmSync(tmpDir, { recursive: true, force: true });
  } else console.log('ffmpeg.exe già presente.');

  console.log('Binari pronti in bin/.');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
