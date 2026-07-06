// Downloads the bundled native tools into bin/ (ffmpeg + yt-dlp).
// These are too large / fast-moving to commit (ffmpeg > GitHub's 100MB per-file
// limit), so CI and fresh local checkouts fetch them here instead. Cross-platform:
// - Windows: bin/{ffmpeg.exe,yt-dlp.exe}
// - Linux:   bin/{ffmpeg,yt-dlp}       (used by the AppImage)
// - macOS:   bin/mac-x64/{ffmpeg,yt-dlp} AND bin/mac-arm64/{ffmpeg,yt-dlp}
//            electron-builder picks the right folder via extraResources.from
//            = bin/mac-${arch} (see electron-builder.yml). Both are always
//            downloaded when the script runs on darwin, so a single CI job can
//            cross-compile both DMGs.
// Pass --force to re-download even if a file exists.

import { createWriteStream, existsSync, mkdirSync, rmSync, copyFileSync, chmodSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const FORCE = process.argv.includes('--force');
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binDir = path.join(root, 'bin');
const tmpDir = path.join(root, '.bin-tmp');
mkdirSync(binDir, { recursive: true });

// yt-dlp: standalone Windows .exe / standalone Linux binary (no Python needed).
// macOS uses the universal `yt-dlp_macos` (works on Intel + Apple Silicon).
const YTDLP_URL = IS_WIN
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : IS_MAC
    ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
    : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';

// ffmpeg static builds. Windows: gyan.dev "essentials" zip. Linux: BtbN static
// tarball on GitHub (reliable, no rate limits), contains .../bin/ffmpeg. macOS
// is handled separately in fetchMac() since we need two archives (per arch).
const FFMPEG_URL = IS_WIN
  ? 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
  : 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz';

// macOS ffmpeg per architecture. Martin Riedl publishes stable "latest"
// redirect URLs for both Intel (amd64) and Apple Silicon (arm64) — the zip
// contains a single `ffmpeg` binary at the root.
const FFMPEG_MAC_URLS = {
  x64:   'https://ffmpeg.martin-riedl.de/redirect/latest/macos/amd64/release/ffmpeg.zip',
  arm64: 'https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffmpeg.zip',
};

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

// Extract an archive into a destination folder. Uses Expand-Archive on Windows,
// unzip for .zip on POSIX (macOS ships it by default), tar for everything else
// (tar handles .tar.xz on Linux). Defaults to the shared tmpDir when no dest given.
function extract(archive, dest = tmpDir) {
  const isZip = archive.toLowerCase().endsWith('.zip');
  let r;
  if (IS_WIN) {
    r = spawnSync('powershell', ['-NoProfile', '-Command',
      `Expand-Archive -Path "${archive}" -DestinationPath "${dest}" -Force`], { stdio: 'inherit' });
  } else if (isZip) {
    r = spawnSync('unzip', ['-o', '-q', archive, '-d', dest], { stdio: 'inherit' });
  } else {
    r = spawnSync('tar', ['-xf', archive, '-C', dest], { stdio: 'inherit' });
  }
  if (r.status !== 0) throw new Error('Estrazione archivio fallita.');
}

// Downloads the Mac ffmpeg + yt-dlp for a single arch (x64 or arm64) into
// bin/mac-<arch>/. yt-dlp_macos is universal, so the same binary is copied
// into both arch folders (the caller passes it in via `universalYtDlp`).
async function fetchMacArch(arch, universalYtDlp) {
  const dir = path.join(binDir, `mac-${arch}`);
  mkdirSync(dir, { recursive: true });

  const ytdlpDest = path.join(dir, 'yt-dlp');
  if (FORCE || !existsSync(ytdlpDest)) {
    copyFileSync(universalYtDlp, ytdlpDest);
    chmodSync(ytdlpDest, 0o755);
  }

  const ffmpegDest = path.join(dir, 'ffmpeg');
  if (FORCE || !existsSync(ffmpegDest)) {
    console.log(`Scarico ffmpeg macOS (${arch})…`);
    const archTmp = path.join(tmpDir, `mac-${arch}`);
    rmSync(archTmp, { recursive: true, force: true });
    mkdirSync(archTmp, { recursive: true });
    const archive = path.join(archTmp, 'ffmpeg.zip');
    await download(FFMPEG_MAC_URLS[arch], archive);
    console.log(`Estraggo ffmpeg macOS (${arch})…`);
    extract(archive, archTmp);
    const found = findFile(archTmp, 'ffmpeg');
    if (!found) throw new Error(`binario ffmpeg non trovato per mac-${arch}.`);
    copyFileSync(found, ffmpegDest);
    chmodSync(ffmpegDest, 0o755);
  } else console.log(`ffmpeg mac-${arch} già presente.`);
}

async function mainMac() {
  // Download the universal yt-dlp once, then fan it out to both arch folders.
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  const ytdlpUniversal = path.join(tmpDir, 'yt-dlp_macos');
  console.log('Scarico yt-dlp (universal macOS)…');
  await download(YTDLP_URL, ytdlpUniversal);
  chmodSync(ytdlpUniversal, 0o755);

  await fetchMacArch('x64', ytdlpUniversal);
  await fetchMacArch('arm64', ytdlpUniversal);

  rmSync(tmpDir, { recursive: true, force: true });
  console.log('Binari pronti in bin/mac-x64/ e bin/mac-arm64/.');
}

async function mainWinLinux() {
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

(IS_MAC ? mainMac() : mainWinLinux()).catch((e) => { console.error(e.message); process.exit(1); });
