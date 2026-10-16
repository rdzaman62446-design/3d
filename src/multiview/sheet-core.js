// Turnaround sheets: one image holding several views of the same character.
// These helpers find each figure and guess which view it is from its outline.
// Everything here is pure, so it runs in tests without a browser.

export const VIEW_CHOICES = ['front', 'back', 'left', 'right', 'top', 'bottom', 'skip'];

// Connected shapes in a 0/1 grid, with bounding boxes and pixel counts.
export function components(data, w, h) {
  const n = w * h;
  const label = new Int32Array(n);
  const out = [];
  const stack = [];
  for (let s = 0; s < n; s++) {
    if (!data[s] || label[s]) continue;
    const c = { id: out.length + 1, x0: w, y0: h, x1: -1, y1: -1, area: 0 };
    label[s] = c.id;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop();
      const x = i % w;
      const y = (i - x) / w;
      c.area++;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      if (x > 0 && data[i - 1] && !label[i - 1]) { label[i - 1] = c.id; stack.push(i - 1); }
      if (x < w - 1 && data[i + 1] && !label[i + 1]) { label[i + 1] = c.id; stack.push(i + 1); }
      if (i >= w && data[i - w] && !label[i - w]) { label[i - w] = c.id; stack.push(i - w); }
      if (i < n - w && data[i + w] && !label[i + w]) { label[i + w] = c.id; stack.push(i + w); }
    }
    out.push(c);
  }
  return { list: out, label };
}

// Groups shapes whose boxes touch (a detached hat or sword stays with its
// figure), then drops small groups such as labels and dimension text.
export function findFigures(data, w, h) {
  const { list, label } = components(data, w, h);
  if (!list.length) return [];
  const margin = Math.max(2, Math.round(Math.max(w, h) * 0.006));
  const parent = list.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const big = list.filter((c) => c.area >= 20);
  for (let a = 0; a < big.length; a++) {
    for (let b = a + 1; b < big.length; b++) {
      const p = big[a];
      const q = big[b];
      if (p.x0 - margin <= q.x1 && q.x0 - margin <= p.x1 && p.y0 - margin <= q.y1 && q.y0 - margin <= p.y1) {
        parent[find(p.id - 1)] = find(q.id - 1);
      }
    }
  }
  const groups = new Map();
  for (const c of big) {
    const r = find(c.id - 1);
    const g = groups.get(r) || { ids: new Set(), x0: w, y0: h, x1: -1, y1: -1, area: 0 };
    g.ids.add(c.id);
    g.x0 = Math.min(g.x0, c.x0);
    g.y0 = Math.min(g.y0, c.y0);
    g.x1 = Math.max(g.x1, c.x1);
    g.y1 = Math.max(g.y1, c.y1);
    g.area += c.area;
    groups.set(r, g);
  }
  const all = [...groups.values()];
  const maxArea = Math.max(...all.map((g) => g.area));
  const figures = all.filter((g) => g.area >= maxArea * 0.05).map((g) => {
    const fw = g.x1 - g.x0 + 1;
    const fh = g.y1 - g.y0 + 1;
    const mask = new Uint8Array(fw * fh);
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        if (g.ids.has(label[(y + g.y0) * w + x + g.x0])) mask[y * fw + x] = 1;
      }
    }
    return { box: { x: g.x0, y: g.y0, w: fw, h: fh }, mask: { width: fw, height: fh, data: mask }, area: g.area };
  });
  // Reading order: figures that overlap vertically share a row; rows go top
  // to bottom, figures in a row left to right.
  const rows = [];
  for (const f of [...figures].sort((a, b) => a.box.y - b.box.y)) {
    const y0 = f.box.y;
    const y1 = f.box.y + f.box.h;
    const row = rows.find((r) => Math.min(y1, r.y1) - Math.max(y0, r.y0) >= 0.3 * Math.min(f.box.h, r.y1 - r.y0));
    if (row) {
      row.items.push(f);
      row.y0 = Math.min(row.y0, y0);
      row.y1 = Math.max(row.y1, y1);
    } else rows.push({ y0, y1, items: [f] });
  }
  return rows.flatMap((r) => r.items.sort((a, b) => a.box.x - b.box.x));
}

// Which way a side view faces, from the feet: toes stick out toward the front.
// Returns about -1 (faces image left) to +1 (faces image right), 0 if unclear.
export function facing(mask) {
  const { width: w, height: h, data } = mask;
  const meanX = (y0, y1) => {
    let sum = 0;
    let count = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < w; x++) if (data[y * w + x]) { sum += x; count++; }
    }
    return count ? sum / count : null;
  };
  const feet = meanX(Math.floor(h * 0.94), h);
  const shins = meanX(Math.floor(h * 0.75), Math.floor(h * 0.88));
  if (feet == null || shins == null) return 0;
  return Math.max(-1, Math.min(1, ((feet - shins) / w) * 8));
}

// Guesses a view for every figure. Outlines alone can't tell front from back
// (they are mirror images), so the first wide figure is taken as the front.
export function guessViews(figures) {
  const result = figures.map(() => ({ view: 'skip', reason: '' }));
  if (!figures.length) return result;
  const H = Math.max(...figures.map((f) => f.box.h));
  const used = new Set();
  const take = (i, view, reason) => {
    if (used.has(view)) {
      result[i] = { view: 'skip', reason: `Looks like another ${view} view.` };
      return;
    }
    used.add(view);
    result[i] = { view, reason };
  };

  const tall = [];
  const short = [];
  figures.forEach((f, i) => (f.box.h >= H * 0.6 ? tall : short).push(i));
  const ratio = (i) => figures[i].box.w / figures[i].box.h;
  const rmax = Math.max(...tall.map(ratio));

  const wide = tall.filter((i) => ratio(i) >= rmax * 0.8);
  const side = tall.filter((i) => ratio(i) <= rmax * 0.62);
  for (const i of tall) {
    if (!wide.includes(i) && !side.includes(i)) result[i] = { view: 'skip', reason: 'Between front and side width, probably a 3/4 view. Carving needs straight-on views.' };
  }

  wide.forEach((i, n) => {
    if (n === 0) take(i, 'front', wide.length > 1 ? 'Widest outline. Front and back outlines match, so the first one is taken as the front.' : 'Widest outline.');
    else if (n === 1) take(i, 'back', 'Same width as the front.');
    else result[i] = { view: 'skip', reason: 'Extra wide view.' };
  });

  const unsure = [];
  for (const i of side) {
    const f = facing(figures[i].mask);
    if (f <= -0.15) take(i, 'right', 'Narrow outline facing left, as seen from your right.');
    else if (f >= 0.15) take(i, 'left', 'Narrow outline facing right, as seen from your left.');
    else unsure.push(i);
  }
  for (const i of unsure) {
    const view = !used.has('right') ? 'right' : 'left';
    take(i, view, 'Narrow outline. Facing direction unclear, so check left and right.');
  }

  short.forEach((i, n) => {
    if (n === 0) take(i, 'top', 'Much shorter than the others, so seen from above or below.');
    else if (n === 1) take(i, 'bottom', 'Second short outline.');
    else result[i] = { view: 'skip', reason: 'Extra short outline.' };
  });
  return result;
}
