// Turns a drawing into a solid silhouette mask, cropped to the drawing.
//
// 1. Ink: pixels darker than the threshold (or opaque pixels in a transparent PNG).
// 2. Fill: anything not reachable from the image border is inside the outline,
//    so plain line drawings become solid shapes.
// 3. Keep the largest connected shape, which drops dimension lines, labels and
//    title blocks drawn around the object.

const MAX_SIDE = 1024;

export async function loadImage(file) {
  if (!file.type.startsWith('image/')) {
    throw new Error(`${file.name} is not an image. Use PNG, JPG, WebP or SVG.`);
  }
  if ('createImageBitmap' in window && file.type !== 'image/svg+xml') {
    return createImageBitmap(file);
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function readPixels(source) {
  const sw = source.width || source.naturalWidth;
  const sh = source.height || source.naturalHeight;
  const k = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k));
  const h = Math.max(1, Math.round(sh * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  return { w, h, rgba: ctx.getImageData(0, 0, w, h).data };
}

export function imageToMask(source, { threshold = 0.6, invert = false, fill = true } = {}) {
  const { w, h, rgba } = readPixels(source);
  const n = w * h;

  let transparent = 0;
  for (let i = 0; i < n; i++) if (rgba[i * 4 + 3] < 128) transparent++;
  const useAlpha = transparent > n * 0.02;

  const ink = new Uint8Array(n);
  const cut = threshold * 255;
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const a = rgba[i * 4 + 3];
    let on;
    if (useAlpha) on = a >= 128;
    else on = 0.2126 * r + 0.7152 * g + 0.0722 * b < cut;
    if (invert && !useAlpha) on = !on;
    ink[i] = on ? 1 : 0;
  }

  let solid = ink;
  if (fill) {
    // Close one-pixel gaps in outlines before filling.
    const closed = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let on = 0;
        for (let dy = -1; dy <= 1 && !on; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < w && yy < h && ink[yy * w + xx]) { on = 1; break; }
          }
        }
        closed[y * w + x] = on;
      }
    }
    const outside = new Uint8Array(n);
    const stack = [];
    const seed = (i) => { if (!closed[i] && !outside[i]) { outside[i] = 1; stack.push(i); } };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
    while (stack.length) {
      const i = stack.pop();
      const x = i % w;
      if (x > 0) seed(i - 1);
      if (x < w - 1) seed(i + 1);
      if (i >= w) seed(i - w);
      if (i < n - w) seed(i + w);
    }
    // Inside = not reachable from the border. Pixels added only by the gap
    // closing that touch the outside are trimmed so the outline keeps its size.
    solid = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (outside[i]) continue;
      if (!ink[i]) {
        const x = i % w;
        const touchesOutside = (x > 0 && outside[i - 1]) || (x < w - 1 && outside[i + 1])
          || (i >= w && outside[i - w]) || (i < n - w && outside[i + w]);
        if (touchesOutside) continue;
      }
      solid[i] = 1;
    }
  }

  const kept = largestComponent(solid, w, h);
  if (!kept) return null;
  return crop(kept, w, h);
}

function largestComponent(data, w, h) {
  const n = w * h;
  const label = new Int32Array(n);
  let best = 0;
  let bestSize = 0;
  let next = 1;
  const stack = [];
  for (let s = 0; s < n; s++) {
    if (!data[s] || label[s]) continue;
    let size = 0;
    label[s] = next;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop();
      size++;
      const x = i % w;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < n - w ? i + w : -1];
      for (const j of nb) {
        if (j >= 0 && data[j] && !label[j]) { label[j] = next; stack.push(j); }
      }
    }
    if (size > bestSize) { bestSize = size; best = next; }
    next++;
  }
  if (!best) return null;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = label[i] === best ? 1 : 0;
  return out;
}

function crop(data, w, h) {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!data[y * w + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const out = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) out.set(data.subarray((y + y0) * w + x0, (y + y0) * w + x0 + cw), y * cw);
  return { width: cw, height: ch, data: out };
}

// Draws the mask into a thumbnail canvas.
export function drawMask(canvas, mask, color) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!mask) return;
  const k = Math.min((W - 12) / mask.width, (H - 12) / mask.height);
  const w = Math.max(1, Math.round(mask.width * k));
  const h = Math.max(1, Math.round(mask.height * k));
  const img = new ImageData(mask.width, mask.height);
  const [r, g, b] = color;
  for (let i = 0; i < mask.data.length; i++) {
    if (!mask.data[i]) continue;
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  const tmp = document.createElement('canvas');
  tmp.width = mask.width;
  tmp.height = mask.height;
  tmp.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tmp, Math.round((W - w) / 2), Math.round((H - h) / 2), w, h);
}
