import { silhouette } from './mask.js';
import { findFigures, guessViews } from './sheet-core.js';

const SHEET_MAX_SIDE = 2400;

// Copies a region of the source, with a little room around it, onto white.
function cropRegion(source, x, y, w, h, padFrac = 0.04) {
  const pad = Math.max(w, h) * padFrac + 2;
  const sx = Math.max(0, x - pad);
  const sy = Math.max(0, y - pad);
  const sw = Math.min(source.width - sx, w + pad * 2);
  const sh = Math.min(source.height - sy, h + pad * 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw));
  canvas.height = Math.max(1, Math.round(sh));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return { canvas, sx, sy, k: canvas.width / sw };
}

// Splits a turnaround sheet into one cropped image per figure, with a guessed view.
export function splitSheet(source, settings) {
  const { w, h, data, scale } = silhouette(source, settings, SHEET_MAX_SIDE);
  const figures = findFigures(data, w, h);
  const guesses = guessViews(figures);
  return figures.map((f, i) => {
    const box = { x: f.box.x / scale, y: f.box.y / scale, w: f.box.w / scale, h: f.box.h / scale };
    return { index: i + 1, crop: cropRegion(source, box.x, box.y, box.w, box.h).canvas, box, view: guesses[i].view, reason: guesses[i].reason };
  });
}

// Turns Claude's rough boxes into tight crops: inside each box (slightly
// enlarged) the biggest drawing is found and the crop is fitted to it.
export function figuresFromBoxes(source, found, settings) {
  const W = source.width;
  const H = source.height;
  return found.map((f, i) => {
    let box = { x: f.box.x0 * W, y: f.box.y0 * H, w: (f.box.x1 - f.box.x0) * W, h: (f.box.y1 - f.box.y0) * H };
    const region = cropRegion(source, box.x, box.y, box.w, box.h, 0.06);
    const sil = silhouette(region.canvas, settings, 1024);
    const shapes = findFigures(sil.data, sil.w, sil.h);
    if (shapes.length) {
      const main = shapes.reduce((a, b) => (b.area > a.area ? b : a));
      const k = sil.scale * region.k;
      box = { x: region.sx + main.box.x / k, y: region.sy + main.box.y / k, w: main.box.w / k, h: main.box.h / k };
    }
    return { index: i + 1, crop: cropRegion(source, box.x, box.y, box.w, box.h).canvas, box, view: f.view, reason: `Claude: ${f.note}` };
  });
}

// The source scaled down for sending to Claude.
export function scaledCopy(source, maxSide = 1568) {
  const k = Math.min(1, maxSide / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * k);
  canvas.height = Math.round(source.height * k);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// The sheet with a numbered box around each figure, for review.
export function numberedSheet(source, figures, maxSide = 900) {
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
