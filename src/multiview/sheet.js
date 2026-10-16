import { silhouette } from './mask.js';
import { findFigures, guessViews } from './sheet-core.js';

const SHEET_MAX_SIDE = 2400;

// Splits a turnaround sheet into one cropped image per figure, with a guessed view.
export function splitSheet(source, settings) {
  const { w, h, data, scale } = silhouette(source, settings, SHEET_MAX_SIDE);
  const figures = findFigures(data, w, h);
  const guesses = guessViews(figures);
  return figures.map((f, i) => {
    // Crop from the original image, with a little room around the figure.
    const pad = Math.round(Math.max(f.box.w, f.box.h) * 0.04) + 2;
    const sx = Math.max(0, (f.box.x - pad) / scale);
    const sy = Math.max(0, (f.box.y - pad) / scale);
    const sw = Math.min(source.width - sx, (f.box.w + pad * 2) / scale);
    const sh = Math.min(source.height - sy, (f.box.h + pad * 2) / scale);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw));
    canvas.height = Math.max(1, Math.round(sh));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return {
      index: i + 1,
      crop: canvas,
      box: { x: f.box.x / scale, y: f.box.y / scale, w: f.box.w / scale, h: f.box.h / scale },
      view: guesses[i].view,
      reason: guesses[i].reason,
    };
  });
}

// The sheet with a numbered tag on each figure, for review and for Claude.
export function numberedSheet(source, figures, maxSide = 1568) {
  const k = Math.min(1, maxSide / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * k);
  canvas.height = Math.round(source.height * k);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const size = Math.max(16, Math.round(canvas.width * 0.022));
  ctx.font = `bold ${size}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const f of figures) {
    const x = (f.box.x + f.box.w / 2) * k;
    const y = Math.max(size, f.box.y * k - size * 0.9);
    ctx.fillStyle = '#c8401a';
    ctx.beginPath();
    ctx.arc(x, y, size * 0.75, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(f.index), x, y + 1);
    ctx.strokeStyle = '#c8401a';
    ctx.lineWidth = 2;
    ctx.strokeRect(f.box.x * k, f.box.y * k, f.box.w * k, f.box.h * k);
  }
  return canvas;
}

// A sample sheet made from the built-in figure: front, right, back, left and
// top in one row, with labels and dimensions like a real reference sheet.
export function sampleSheet(drawView) {
  const mirror = (c) => {
    const m = document.createElement('canvas');
    m.width = c.width;
    m.height = c.height;
    const ctx = m.getContext('2d');
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(c, 0, 0);
    return m;
  };
  const front = drawView('front');
  const right = drawView('right');
  const top = drawView('top');
  const parts = [front, right, mirror(front), mirror(right), top];
  const H = Math.max(...parts.map((p) => p.height));
  const canvas = document.createElement('canvas');
  canvas.width = parts.reduce((s, p) => s + p.width, 0);
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let x = 0;
  for (const p of parts) {
    ctx.drawImage(p, x, 0);
    x += p.width;
  }
  // The single-view drawings carry their own captions, mirrored on the copies.
  // Replace them with one set of plain captions.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, 40);
  ctx.fillRect(0, H - 50, canvas.width, 50);
  ctx.fillStyle = '#5b6773';
  ctx.font = '16px monospace';
  ctx.textAlign = 'center';
  x = 0;
  for (const [i, p] of parts.entries()) {
    ctx.fillText(['FRONT', 'SIDE', 'BACK', 'SIDE', 'TOP'][i], x + p.width / 2, H - 22);
    x += p.width;
  }
  return canvas;
}
