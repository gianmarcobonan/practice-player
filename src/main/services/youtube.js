'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { ytDlpPath, ffmpegPath, dataDir } = require('../paths');

function downloadsDir() {
  const d = path.join(dataDir(), 'downloads');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// Download a URL with yt-dlp.
//  - mode 'audio' (default): bestaudio container (m4a/webm/opus) fed straight to
//    our ffmpeg decoder, no re-encode.
//  - mode 'video': best video+audio merged into an mp4 (also decodable for the
//    audio engine, and playable in the <video> element for song tutorials).
// onProgress(percent 0..100) is called during the download.
function download(url, mode, onProgress) {
  // Back-compat: download(url, onProgress) still works (mode defaults to audio).
  if (typeof mode === 'function') { onProgress = mode; mode = 'audio'; }
  const wantVideo = mode === 'video';
  return new Promise((resolve, reject) => {
    const outTpl = path.join(downloadsDir(), '%(title).200B [%(id)s].%(ext)s');
    // Prefer H.264 + AAC in mp4 so the <video> element always renders the picture
    // (Chromium plays avc1/mp4a everywhere; av1/opus can fail to load). Fall back
    // to any mp4, then anything, merging into mp4.
    const formatArgs = wantVideo
      ? ['-f', 'bv*[vcodec^=avc1]+ba[acodec^=mp4a]/b[ext=mp4]/bv*+ba/b', '--merge-output-format', 'mp4']
      : ['-f', 'bestaudio/best'];
    const args = [
      '--no-playlist',
      '--no-warnings',
      ...formatArgs,
      '--ffmpeg-location', path.dirname(ffmpegPath()),
      '-o', outTpl,
      '--no-simulate',
      '--print', 'after_move:filepath',
      // Structured progress so we can report percent + ETA (remaining) + speed.
      '--progress-template', 'download:@@PP@@|%(progress._percent_str)s|%(progress._eta_str)s|%(progress._speed_str)s',
      '--newline',
      url
    ];

    const yt = spawn(ytDlpPath(), args, { windowsHide: true });
    let stderr = '';
    let resultPath = '';
    let buf = '';

    const handleLine = (line) => {
      const l = line.trim();
      if (!l) return;
      // Structured progress: "@@PP@@| 12.3%|00:42|1.20MiB/s"
      if (l.startsWith('@@PP@@')) {
        const p = l.split('|');
        const percent = parseFloat((p[1] || '').replace('%', '').trim());
        if (onProgress && !isNaN(percent)) {
          onProgress({ percent, eta: (p[2] || '').trim(), speed: (p[3] || '').trim() });
        }
        return;
      }
      // Fallback for the default progress line: "[download]  12.3% of ~3.4MiB at ..."
      const m = l.match(/\[download\]\s+([\d.]+)%/);
      if (m && onProgress) onProgress({ percent: parseFloat(m[1]), eta: '', speed: '' });
      // The after_move:filepath print is a bare existing path.
      if (!l.startsWith('[') && fs.existsSync(l)) resultPath = l;
    };

    yt.stdout.on('data', (d) => {
      buf += d.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        handleLine(buf.slice(0, idx));
        buf = buf.slice(idx + 1);
      }
    });
    yt.stderr.on('data', (d) => { stderr += d.toString(); });
    yt.on('error', (err) => reject(new Error(`Impossibile avviare yt-dlp: ${err.message}`)));
    yt.on('close', (code) => {
      if (buf) handleLine(buf);
      if (code !== 0) {
        return reject(new Error(`yt-dlp ha fallito (codice ${code}): ${stderr.trim().split('\n').slice(-3).join(' ')}`));
      }
      if (!resultPath || !fs.existsSync(resultPath)) {
        return reject(new Error('Download completato ma file non trovato.'));
      }
      resolve({ filePath: resultPath, title: path.basename(resultPath).replace(/\.[^.]+$/, '') });
    });
  });
}

// Fast YouTube search (flat extraction): returns up to `count` results with
// id/title/duration/channel, without downloading anything.
function search(query, count = 8) {
  return new Promise((resolve, reject) => {
    const args = [
      '--no-warnings', '--no-playlist', '--flat-playlist',
      '--print', '%(id)s\t%(title)s\t%(duration)s\t%(channel)s',
      `ytsearch${count}:${query}`
    ];
    const yt = spawn(ytDlpPath(), args, { windowsHide: true });
    let out = '', stderr = '';
    yt.stdout.on('data', (d) => { out += d.toString(); });
    yt.stderr.on('data', (d) => { stderr += d.toString(); });
    yt.on('error', (err) => reject(new Error(`Impossibile avviare yt-dlp: ${err.message}`)));
    yt.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Ricerca fallita: ${stderr.trim().split('\n').slice(-2).join(' ')}`));
      }
      const results = out.split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean).map((l) => {
        const [id, title, duration, channel] = l.split('\t');
        return { id, title: title || id, duration: parseFloat(duration) || 0, channel: channel || '', url: `https://www.youtube.com/watch?v=${id}` };
      }).filter((r) => r.id);
      resolve(results);
    });
  });
}

// Resolve a directly-playable audio stream URL (for preview before downloading).
function streamUrl(videoUrl) {
  return new Promise((resolve, reject) => {
    const args = ['-f', 'bestaudio[ext=m4a]/bestaudio', '-g', '--no-warnings', '--no-playlist', videoUrl];
    const yt = spawn(ytDlpPath(), args, { windowsHide: true });
    let out = '', stderr = '';
    yt.stdout.on('data', (d) => { out += d.toString(); });
    yt.stderr.on('data', (d) => { stderr += d.toString(); });
    yt.on('error', (err) => reject(new Error(`Impossibile avviare yt-dlp: ${err.message}`)));
    yt.on('close', (code) => {
      const url = out.split('\n').map((s) => s.trim()).filter(Boolean)[0];
      if (code !== 0 || !url) return reject(new Error('anteprima non disponibile'));
      resolve(url);
    });
  });
}

module.exports = { download, search, streamUrl };
