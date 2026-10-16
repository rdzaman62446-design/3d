import { wallLength, wallDir, clampOpening, tidyOpenings, endsAt, newId, round1, OPENING_DEFAULTS } from './model.js';

const HANDLE_PX = 6;
const ANGLE_SNAP = (7 * Math.PI) / 180;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function project(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return { x: a.x + dx * t, y: a.y + dy * t, along: t * Math.sqrt(len2) };
}

function readColors() {
  const s = getComputedStyle(document.documentElement);
  const v = (n) => s.getPropertyValue(n).trim();
  return {
    bg: v('--canvas'),
    gridMinor: v('--grid-minor'),
    gridMajor: v('--grid-major'),
    wall: v('--wall'),
    ink: v('--ink'),
    muted: v('--ink-2'),
    accent: v('--accent'),
    mark: v('--mark'),
    mono: v('--font-mono') || 'monospace',
  };
}

export const TOOL_HINTS = {
  select: 'Click a wall, door or window to edit it. Drag to move. Drag the round handles to move wall ends. Drag empty space to pan, scroll to zoom.',
  wall: 'Click to start a wall, then click each corner. Type a length in mm and press Enter for an exact wall. Hold Shift to turn off angle snapping. Esc or double-click ends the run.',
  door: 'Click on a wall to place a door. Edit its width and height on the left.',
  window: 'Click on a wall to place a window. Edit its width, height and sill on the left.',
  calibrate: 'Click two points on the traced drawing that are a known distance apart.',
};

export class PlanEditor {
  constructor(canvas, history, hooks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.history = history;
    this.hooks = hooks;
    this.tool = 'select';
    this.view = { scale: 0.06, ox: 60, oy: 60 };
    this.size = { width: 1, height: 1 };
    this.selection = null;
    this.hover = null;
    this.chain = null;
    this.cursor = null;
    this.typed = '';
    this.drag = null;
    this.shift = false;
    this.space = false;
    this.underlay = null;
    this.calib = null;
    this.gridSnap = 50;
    this.colors = readColors();
    this.pending = false;
    this.fitted = false;

    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointerleave', () => { if (!this.drag) { this.cursor = null; this.hover = null; this.requestRender(); } });
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('dblclick', () => this.endChain());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') this.shift = false;
      if (e.code === 'Space') this.space = false;
      this.requestRender();
    });
    history.subscribe(() => {
      if (this.selection && !this.selected()) this.select(null);
      this.requestRender();
    });
  }

  get plan() {
    return this.history.state;
  }

  refreshTheme() {
    this.colors = readColors();
    this.requestRender();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.size = { width: r.width, height: r.height };
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    if (!this.fitted) {
      this.fitted = true;
      this.fit();
    }
    this.render();
  }

  toWorld(sx, sy) {
    return { x: (sx - this.view.ox) / this.view.scale, y: (sy - this.view.oy) / this.view.scale };
  }

  toScreen(p) {
    return { x: p.x * this.view.scale + this.view.ox, y: p.y * this.view.scale + this.view.oy };
  }

  eventPoint(e) {
    const r = this.canvas.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }

  fit() {
    const pts = this.plan.walls.flatMap((w) => [w.a, w.b]);
    if (this.underlay) {
      const u = this.underlay;
      pts.push({ x: u.x, y: u.y }, { x: u.x + u.img.width * u.mmPerPx, y: u.y + u.img.height * u.mmPerPx });
    }
    if (!pts.length) pts.push({ x: 0, y: 0 }, { x: 10000, y: 8000 });
    const minX = Math.min(...pts.map((p) => p.x));
    const maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    const { width, height } = this.size;
    const pad = 56;
    const scale = Math.min((width - pad * 2) / Math.max(maxX - minX, 1000), (height - pad * 2) / Math.max(maxY - minY, 1000));
    this.view.scale = Math.max(0.002, Math.min(2, scale));
    this.view.ox = width / 2 - ((minX + maxX) / 2) * this.view.scale;
    this.view.oy = height / 2 - ((minY + maxY) / 2) * this.view.scale;
    this.requestRender();
  }

  setTool(tool) {
    this.tool = tool;
    this.chain = null;
    this.typed = '';
    if (tool !== 'calibrate') this.calib = null;
    this.hooks.onToolChange?.(tool);
    this.requestRender();
  }

  select(sel) {
    this.selection = sel;
    this.hooks.onSelect?.(sel);
    this.requestRender();
  }

  selected() {
    const s = this.selection;
    if (!s) return null;
    return s.kind === 'wall' ? this.plan.walls.find((w) => w.id === s.id) : this.plan.openings.find((o) => o.id === s.id);
  }

  // ---------- snapping and hit testing ----------

  snap(raw, from, exclude = []) {
    const tol = 10 / this.view.scale;
    let best = null;
    let bestD = tol;
    const skip = new Set(exclude.map((r) => `${r.wallId}:${r.end}`));
    for (const w of this.plan.walls) {
      for (const end of ['a', 'b']) {
        if (skip.has(`${w.id}:${end}`)) continue;
        const d = dist(w[end], raw);
        if (d < bestD) { bestD = d; best = w[end]; }
      }
    }
    if (this.chain && !skip.size) {
      const d = dist(this.chain.first, raw);
      if (d < bestD) { bestD = d; best = this.chain.first; }
    }
    if (best) return { x: best.x, y: best.y, kind: 'end' };
    if (from && !this.shift) {
      const dx = raw.x - from.x;
      const dy = raw.y - from.y;
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        const ang = Math.atan2(dy, dx);
        const snapped = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
        if (Math.abs(ang - snapped) < ANGLE_SNAP) {
          const L = Math.round(len / 10) * 10;
          return { x: round1(from.x + Math.cos(snapped) * L), y: round1(from.y + Math.sin(snapped) * L), kind: 'angle' };
        }
      }
    }
    const g = this.gridSnap;
    return { x: Math.round(raw.x / g) * g, y: Math.round(raw.y / g) * g, kind: 'grid' };
  }

  hitWall(p, extraPx = 6) {
    const tol = extraPx / this.view.scale;
    let best = null;
    let bestD = Infinity;
    for (const w of this.plan.walls) {
      const q = project(p, w.a, w.b);
      const d = dist(p, q);
      if (d <= w.thickness / 2 + tol && d < bestD) { bestD = d; best = { wall: w, along: q.along }; }
    }
    return best;
  }

  hitOpening(p) {
    const tol = 6 / this.view.scale;
    for (const o of this.plan.openings) {
      const w = this.plan.walls.find((x) => x.id === o.wallId);
      if (!w) continue;
      const q = project(p, w.a, w.b);
      if (dist(p, q) <= w.thickness / 2 + tol && Math.abs(q.along - o.offset) <= o.width / 2) return o;
    }
    return null;
  }

  // ---------- pointer input ----------

  onPointerDown(e) {
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(e.pointerId);
    const { sx, sy } = this.eventPoint(e);
    const raw = this.toWorld(sx, sy);
    if (e.button === 1 || e.button === 2 || (e.button === 0 && this.space)) {
      this.drag = { type: 'pan', sx, sy, ox: this.view.ox, oy: this.view.oy };
      return;
    }
    if (e.button !== 0) return;
    if (this.tool === 'wall') this.wallClick(raw);
    else if (this.tool === 'door' || this.tool === 'window') this.placeOpening(raw);
    else if (this.tool === 'calibrate') this.calibClick(raw);
    else this.selectDown(raw, sx, sy);
  }

  onPointerMove(e) {
    const { sx, sy } = this.eventPoint(e);
    const raw = this.toWorld(sx, sy);
    this.shift = e.shiftKey;
    const d = this.drag;
    if (d?.type === 'pan') {
      this.view.ox = d.ox + sx - d.sx;
      this.view.oy = d.oy + sy - d.sy;
      if (Math.abs(sx - d.sx) + Math.abs(sy - d.sy) > 3) d.moved = true;
    } else if (d?.type === 'end') {
      const p = this.snap(raw, null, d.refs);
      this.moveEnds(d, d.refs.map((r) => ({ ...r, to: p })));
    } else if (d?.type === 'wall') {
      const g = this.gridSnap;
      const dx = Math.round((raw.x - d.start.x) / g) * g;
      const dy = Math.round((raw.y - d.start.y) / g) * g;
      this.moveEnds(d, d.refs.map((r) => ({ ...r, to: { x: r.from.x + dx, y: r.from.y + dy } })));
    } else if (d?.type === 'opening') {
      const next = structuredClone(d.base);
      const o = next.openings.find((x) => x.id === d.id);
      const w = next.walls.find((x) => x.id === o.wallId);
      o.offset = Math.round(project(raw, w.a, w.b).along / 10) * 10;
      clampOpening(o, w);
      this.history.preview(next);
      d.moved = true;
    } else {
      if (this.tool === 'wall') this.cursor = this.snap(raw, this.chain?.last);
      else if (this.tool === 'calibrate') this.cursor = raw;
      else this.cursor = null;
      this.hover = this.tool === 'select' ? this.hitOpening(raw) || this.hitWall(raw)?.wall || null
        : this.tool === 'door' || this.tool === 'window' ? this.openingPreview(raw) : null;
    }
    this.requestRender();
  }

  onPointerUp() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.type === 'pan' && !d.moved && d.deselect) this.select(null);
    if (d.base && d.moved) this.history.settle(d.base);
  }

  onWheel(e) {
    e.preventDefault();
    const { sx, sy } = this.eventPoint(e);
    const before = this.toWorld(sx, sy);
    const k = Math.exp(-e.deltaY * 0.0015);
    this.view.scale = Math.max(0.002, Math.min(2, this.view.scale * k));
    this.view.ox = sx - before.x * this.view.scale;
    this.view.oy = sy - before.y * this.view.scale;
    this.requestRender();
  }

  moveEnds(drag, moves) {
    const next = structuredClone(drag.base);
    for (const m of moves) {
      const w = next.walls.find((x) => x.id === m.wallId);
      if (w) w[m.end] = { x: round1(m.to.x), y: round1(m.to.y) };
    }
    next.walls = next.walls.filter((w) => wallLength(w) >= 1);
    tidyOpenings(next);
    this.history.preview(next);
    drag.moved = true;
  }

  selectDown(raw, sx, sy) {
    const plan = this.plan;
    const sel = this.selected();
    if (sel && this.selection.kind === 'wall') {
      for (const end of ['a', 'b']) {
        const s = this.toScreen(sel[end]);
        if (Math.hypot(s.x - sx, s.y - sy) <= HANDLE_PX + 4) {
          this.drag = { type: 'end', refs: endsAt(plan, sel[end]), base: plan };
          return;
        }
      }
    }
    const op = this.hitOpening(raw);
    if (op) {
      this.select({ kind: 'opening', id: op.id });
      this.drag = { type: 'opening', id: op.id, base: plan };
      return;
    }
    const hit = this.hitWall(raw);
    if (hit) {
      const w = hit.wall;
      this.select({ kind: 'wall', id: w.id });
      const refs = [...endsAt(plan, w.a), ...endsAt(plan, w.b)].map((r) => {
        const src = plan.walls.find((x) => x.id === r.wallId)[r.end];
        return { ...r, from: { ...src } };
      });
      this.drag = { type: 'wall', start: raw, refs, base: plan };
      return;
    }
    this.drag = { type: 'pan', sx, sy, ox: this.view.ox, oy: this.view.oy, deselect: true };
  }

  wallClick(raw) {
    const p = this.snap(raw, this.chain?.last);
    if (!this.chain) {
      this.chain = { first: { x: p.x, y: p.y }, last: { x: p.x, y: p.y } };
      this.typed = '';
      this.requestRender();
      return;
    }
    this.addSegment(p);
  }

  addSegment(p) {
    const a = this.chain.last;
    if (dist(a, p) < 1) return;
    const plan = this.plan;
    this.history.update((next) => {
      next.walls.push({
        id: newId('w'),
        a: { x: round1(a.x), y: round1(a.y) },
        b: { x: round1(p.x), y: round1(p.y) },
        thickness: plan.defaults.wallThickness,
        height: plan.defaults.wallHeight,
      });
    });
    this.typed = '';
    if (dist(p, this.chain.first) < 0.5) this.chain = null;
    else this.chain.last = { x: p.x, y: p.y };
    this.requestRender();
  }

  endChain() {
    if (!this.chain) return;
    this.chain = null;
    this.typed = '';
    this.requestRender();
  }

  openingPreview(raw) {
    const hit = this.hitWall(raw, 12);
    if (!hit) return null;
    const o = { ...OPENING_DEFAULTS[this.tool], type: this.tool, wallId: hit.wall.id, offset: Math.round(hit.along / 10) * 10, preview: true };
    return clampOpening(o, hit.wall);
  }

  placeOpening(raw) {
    const o = this.openingPreview(raw);
    if (!o) {
      this.hooks.onMessage?.(`Click on a wall to place a ${this.tool}.`);
      return;
    }
    const id = newId('o');
    delete o.preview;
    this.history.update((next) => next.openings.push({ ...o, id }));
    this.select({ kind: 'opening', id });
  }

  // ---------- tracing underlay ----------

  setUnderlay(img) {
    if (!img) {
      this.underlay = null;
      this.requestRender();
      return;
    }
    // Start at 10 m wide until it is calibrated.
    this.underlay = { img, x: 0, y: 0, mmPerPx: 10000 / img.width, opacity: 0.5 };
    this.fit();
  }

  calibClick(raw) {
    if (!this.underlay) {
      this.hooks.onMessage?.('Add a drawing to trace before calibrating.');
      return;
    }
    if (!this.calib || this.calib.p2) this.calib = { p1: raw, p2: null };
    else {
      this.calib.p2 = raw;
      this.hooks.onCalibrate?.(Math.round(dist(this.calib.p1, raw)));
    }
    this.requestRender();
  }

  applyCalibration(realMm) {
    const c = this.calib;
    const u = this.underlay;
    if (!c?.p2 || !u || !(realMm > 0)) return;
    const k = realMm / dist(c.p1, c.p2);
    u.mmPerPx *= k;
    u.x = c.p1.x - (c.p1.x - u.x) * k;
    u.y = c.p1.y - (c.p1.y - u.y) * k;
    this.calib = null;
    this.setTool('wall');
    this.fit();
  }

  // ---------- keyboard ----------

  onKeyDown(e) {
    if (!this.hooks.isActive?.()) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Shift') { this.shift = true; this.requestRender(); return; }
    if (e.code === 'Space' && document.activeElement === this.canvas) { this.space = true; e.preventDefault(); return; }
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.history.redo() : this.history.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.history.redo(); return; }
    if (mod) return;

    if (this.tool === 'wall' && this.chain) {
      if (/^[0-9.]$/.test(e.key)) { this.typed += e.key; e.preventDefault(); this.requestRender(); return; }
      if (e.key === 'Backspace' && this.typed) { this.typed = this.typed.slice(0, -1); e.preventDefault(); this.requestRender(); return; }
      if (e.key === 'Enter' && this.typed) {
        const L = parseFloat(this.typed);
        if (L > 0) {
          const from = this.chain.last;
          const to = this.cursor || { x: from.x + 1, y: from.y };
          let dx = to.x - from.x;
          let dy = to.y - from.y;
          const len = Math.hypot(dx, dy);
          if (len < 1e-6) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }
          this.addSegment({ x: round1(from.x + dx * L), y: round1(from.y + dy * L) });
        }
        e.preventDefault();
        return;
      }
    }
    if (e.key === 'Escape') {
      if (this.chain) this.endChain();
      else if (this.calib) { this.calib = null; this.requestRender(); }
      else this.select(null);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selection) {
      e.preventDefault();
      this.deleteSelection();
      return;
    }
    const tools = { v: 'select', w: 'wall', d: 'door', n: 'window' };
    const t = tools[e.key.toLowerCase()];
    if (t) this.setTool(t);
    if (e.key.toLowerCase() === 'f') this.fit();
  }

  deleteSelection() {
    const s = this.selection;
    if (!s) return;
    this.history.update((next) => {
      if (s.kind === 'wall') next.walls = next.walls.filter((w) => w.id !== s.id);
      else next.openings = next.openings.filter((o) => o.id !== s.id);
      tidyOpenings(next);
    });
    this.select(null);
  }

  // ---------- drawing ----------

  requestRender() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.render();
    });
  }

  render() {
    const { ctx } = this;
    const { width, height } = this.size;
    ctx.setTransform(this.dpr || 1, 0, 0, this.dpr || 1, 0, 0);
    ctx.fillStyle = this.colors.bg;
    ctx.fillRect(0, 0, width, height);
    this.drawGrid();
    this.drawUnderlay();
    this.drawWalls();
    this.drawOpenings();
    this.drawDimensions();
    this.drawSelection();
    this.drawPreview();
    this.drawCalibration();
    this.drawScaleBar();
  }

  drawGrid() {
    const { ctx, view } = this;
    const { width, height } = this.size;
    const minor = [10, 50, 100, 500, 1000, 5000, 10000].find((s) => s * view.scale >= 9) || 50000;
    const major = minor * 10;
    const tl = this.toWorld(0, 0);
    const br = this.toWorld(width, height);
    const lines = (step, color, lw) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
        const s = Math.round(x * view.scale + view.ox) + 0.5;
        ctx.moveTo(s, 0);
        ctx.lineTo(s, height);
      }
      for (let y = Math.floor(tl.y / step) * step; y <= br.y; y += step) {
        const s = Math.round(y * view.scale + view.oy) + 0.5;
        ctx.moveTo(0, s);
        ctx.lineTo(width, s);
      }
      ctx.stroke();
    };
    lines(minor, this.colors.gridMinor, 1);
    lines(major, this.colors.gridMajor, 1);
  }

  drawUnderlay() {
    const u = this.underlay;
    if (!u) return;
    const { ctx } = this;
    const p = this.toScreen(u);
    ctx.globalAlpha = u.opacity;
    ctx.drawImage(u.img, p.x, p.y, u.img.width * u.mmPerPx * this.view.scale, u.img.height * u.mmPerPx * this.view.scale);
    ctx.globalAlpha = 1;
  }

  // Runs `fn` with the context in the wall's own frame: u along the wall in mm
  // from end a, n across it.
  inWallFrame(w, fn) {
    const { ctx } = this;
    const a = this.toScreen(w.a);
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x));
    ctx.scale(this.view.scale, this.view.scale);
    fn(ctx, 1 / this.view.scale);
    ctx.restore();
  }

  drawWalls() {
    for (const w of this.plan.walls) {
      const L = wallLength(w);
      const t = w.thickness;
      this.inWallFrame(w, (ctx) => {
        ctx.fillStyle = this.colors.wall;
        ctx.fillRect(-t / 2, -t / 2, L + t, t);
      });
    }
  }

  drawOpening(o, w, { ghost = false } = {}) {
    const t = w.thickness;
    this.inWallFrame(w, (ctx, px) => {
      const u0 = o.offset - o.width / 2;
      ctx.fillStyle = this.colors.bg;
      ctx.fillRect(u0, -t / 2 - px, o.width, t + px * 2);
      ctx.strokeStyle = ghost ? this.colors.accent : this.colors.ink;
      ctx.lineWidth = 1.25 * px;
      if (ghost) ctx.setLineDash([4 * px, 3 * px]);
      if (o.type === 'window') {
        ctx.strokeRect(u0, -t / 2, o.width, t);
        ctx.beginPath();
        ctx.moveTo(u0, -t / 6);
        ctx.lineTo(u0 + o.width, -t / 6);
        ctx.moveTo(u0, t / 6);
        ctx.lineTo(u0 + o.width, t / 6);
        ctx.stroke();
      } else {
        // Leaf drawn open at 90°, hinged at the start of the opening.
        ctx.beginPath();
        ctx.moveTo(u0, -t / 2);
        ctx.lineTo(u0, -t / 2 - o.width);
        ctx.stroke();
        ctx.beginPath();
        ctx.lineWidth = 0.75 * px;
        ctx.arc(u0, -t / 2, o.width, -Math.PI / 2, 0);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(u0, -t / 2);
        ctx.lineTo(u0, t / 2);
        ctx.moveTo(u0 + o.width, -t / 2);
        ctx.lineTo(u0 + o.width, t / 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    });
  }

  drawOpenings() {
    const walls = new Map(this.plan.walls.map((w) => [w.id, w]));
    for (const o of this.plan.openings) {
      const w = walls.get(o.wallId);
      if (w) this.drawOpening(o, w);
    }
    if (this.hover?.preview) {
      const w = walls.get(this.hover.wallId);
      if (w) this.drawOpening(this.hover, w, { ghost: true });
    }
  }

  label(text, x, y, angle, { color = this.colors.muted, size = 11, bg = true } = {}) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(x, y);
    // Keep text upright; vertical dimensions read from the right, as on drawings.
    const a = ((((angle + Math.PI / 2) % Math.PI) + Math.PI) % Math.PI) - Math.PI / 2;
    ctx.rotate(a);
    ctx.font = `${size}px ${this.colors.mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (bg) {
      const m = ctx.measureText(text).width;
      ctx.fillStyle = this.colors.bg;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(-m / 2 - 3, -size / 2 - 2, m + 6, size + 4);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  drawDimensions() {
    for (const w of this.plan.walls) {
      const L = wallLength(w);
      if (L * this.view.scale < 44) continue;
      const d = wallDir(w);
      const n = { x: d.y, y: -d.x };
      const off = (w.thickness / 2) * this.view.scale + 11;
      const mid = this.toScreen({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 });
      this.label(`${Math.round(L)}`, mid.x + n.x * off, mid.y + n.y * off, Math.atan2(d.y, d.x));
    }
  }

  drawSelection() {
    const { ctx } = this;
    const outline = (item, color, width) => {
      if (!item) return;
      if (item.wallId) {
        const w = this.plan.walls.find((x) => x.id === item.wallId);
        if (!w || item.preview) return;
        this.inWallFrame(w, (c, px) => {
          c.strokeStyle = color;
          c.lineWidth = width * px;
          c.strokeRect(item.offset - item.width / 2, -w.thickness / 2, item.width, w.thickness);
        });
      } else if (item.a) {
        const L = wallLength(item);
        const t = item.thickness;
        this.inWallFrame(item, (c, px) => {
          c.strokeStyle = color;
          c.lineWidth = width * px;
          c.strokeRect(-t / 2, -t / 2, L + t, t);
        });
      }
    };
    if (this.hover && this.hover !== this.selected()) outline(this.hover, this.colors.accent, 1);
    const sel = this.selected();
    outline(sel, this.colors.mark, 2);
    if (sel && this.selection.kind === 'wall') {
      for (const end of ['a', 'b']) {
        const s = this.toScreen(sel[end]);
        ctx.beginPath();
        ctx.arc(s.x, s.y, HANDLE_PX, 0, Math.PI * 2);
        ctx.fillStyle = this.colors.bg;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = this.colors.mark;
        ctx.stroke();
      }
    }
  }

  drawPreview() {
    if (this.tool !== 'wall') return;
    const { ctx } = this;
    const c = this.cursor;
    if (this.chain) {
      const a = this.chain.last;
      let b = c || a;
      if (this.typed) {
        const L = parseFloat(this.typed) || 0;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }
        b = { x: a.x + dx * L, y: a.y + dy * L };
      }
      const L = dist(a, b);
      if (L > 0) {
        const ghost = { a, b, thickness: this.plan.defaults.wallThickness };
        this.inWallFrame(ghost, (g, px) => {
          g.fillStyle = this.colors.accent;
          g.globalAlpha = 0.28;
          g.fillRect(-ghost.thickness / 2, -ghost.thickness / 2, L + ghost.thickness, ghost.thickness);
          g.globalAlpha = 1;
          g.strokeStyle = this.colors.accent;
          g.lineWidth = px;
          g.setLineDash([5 * px, 4 * px]);
          g.beginPath();
          g.moveTo(0, 0);
          g.lineTo(L, 0);
          g.stroke();
          g.setLineDash([]);
        });
        const sb = this.toScreen(b);
        const deg = Math.round((Math.atan2(-(b.y - a.y), b.x - a.x) * 180) / Math.PI);
        const text = this.typed ? `${this.typed}▏ mm` : `${Math.round(L)} mm  ${deg}°`;
        this.label(text, sb.x + 14 + text.length * 3.3, sb.y - 16, 0, { color: this.colors.accent, size: 12 });
      }
      const s = this.toScreen(this.chain.first);
      ctx.strokeStyle = this.colors.accent;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(s.x - 4, s.y - 4, 8, 8);
    }
    if (c) {
      const s = this.toScreen(c);
      ctx.strokeStyle = c.kind === 'end' ? this.colors.mark : this.colors.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (c.kind === 'end') ctx.rect(s.x - 5, s.y - 5, 10, 10);
      else {
        ctx.moveTo(s.x - 7, s.y);
        ctx.lineTo(s.x + 7, s.y);
        ctx.moveTo(s.x, s.y - 7);
        ctx.lineTo(s.x, s.y + 7);
      }
      ctx.stroke();
    }
  }

  drawCalibration() {
    if (this.tool !== 'calibrate' || !this.calib) return;
    const { ctx } = this;
    const p1 = this.toScreen(this.calib.p1);
    const p2 = this.toScreen(this.calib.p2 || this.cursor || this.calib.p1);
    ctx.strokeStyle = this.colors.mark;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    for (const p of [p1, p2]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = this.colors.mark;
      ctx.fill();
    }
  }

  drawScaleBar() {
    const { ctx } = this;
    const target = 110 / this.view.scale;
    const steps = [100, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];
    const mm = steps.reduce((best, s) => (s <= target ? s : best), steps[0]);
    const px = mm * this.view.scale;
    const x = 16;
    const y = this.size.height - 18;
    ctx.strokeStyle = this.colors.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y);
    ctx.lineTo(x + px, y);
    ctx.lineTo(x + px, y - 5);
    ctx.stroke();
    ctx.font = `11px ${this.colors.mono}`;
    ctx.fillStyle = this.colors.ink;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(mm >= 1000 ? `${mm / 1000} m` : `${mm} mm`, x + px + 6, y + 1);
  }
}
