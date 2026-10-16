// Floor plan data. Coordinates are millimetres in plan space: x to the right,
// y down the page. In 3D, plan x becomes X, plan y becomes Z and walls rise along Y.

export const OPENING_DEFAULTS = {
  door: { width: 900, height: 2100, sill: 0 },
  window: { width: 1200, height: 1200, sill: 900 },
};

export function newId(prefix) {
  return prefix + Math.random().toString(36).slice(2, 9);
}

export function emptyPlan() {
  return {
    version: 1,
    units: 'mm',
    defaults: { wallHeight: 2700, wallThickness: 200 },
    floor: true,
    walls: [],
    openings: [],
  };
}

export function wallLength(w) {
  return Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
}

export function wallDir(w) {
  const len = wallLength(w) || 1;
  return { x: (w.b.x - w.a.x) / len, y: (w.b.y - w.a.y) / len };
}

export function clampOpening(op, wall) {
  const L = wallLength(wall);
  op.width = Math.max(50, Math.min(op.width, L));
  op.offset = Math.min(Math.max(op.offset, op.width / 2), Math.max(op.width / 2, L - op.width / 2));
  op.sill = Math.max(0, Math.min(op.sill, wall.height - 50));
  op.height = Math.max(50, Math.min(op.height, wall.height - op.sill));
  return op;
}

// Drops openings whose wall is gone and keeps the rest inside their walls.
export function tidyOpenings(plan) {
  const walls = new Map(plan.walls.map((w) => [w.id, w]));
  plan.openings = plan.openings.filter((o) => walls.has(o.wallId));
  for (const o of plan.openings) clampOpening(o, walls.get(o.wallId));
  return plan;
}

// Every wall end that sits on `point`, so joined walls move together.
export function endsAt(plan, point, tol = 0.5) {
  const refs = [];
  for (const w of plan.walls) {
    for (const end of ['a', 'b']) {
      if (Math.hypot(w[end].x - point.x, w[end].y - point.y) <= tol) refs.push({ wallId: w.id, end });
    }
  }
  return refs;
}

// Changes a wall's length by moving its end point (and anything joined to it).
export function setWallLength(plan, wallId, length) {
  const w = plan.walls.find((x) => x.id === wallId);
  if (!w || !(length > 0)) return plan;
  const d = wallDir(w);
  const old = { ...w.b };
  const next = { x: round1(w.a.x + d.x * length), y: round1(w.a.y + d.y * length) };
  for (const ref of endsAt(plan, old)) {
    const target = plan.walls.find((x) => x.id === ref.wallId);
    target[ref.end] = { ...next };
  }
  return tidyOpenings(plan);
}

export function round1(v) {
  return Math.round(v * 10) / 10;
}

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

// Validates an imported plan file and fills in anything missing.
export function normalizePlan(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.walls)) {
    throw new Error('This file is not a Draft3D floor plan. It needs a "walls" list.');
  }
  const plan = emptyPlan();
  plan.defaults.wallHeight = num(input.defaults?.wallHeight, plan.defaults.wallHeight);
  plan.defaults.wallThickness = num(input.defaults?.wallThickness, plan.defaults.wallThickness);
  plan.floor = input.floor !== false;
  plan.walls = input.walls.map((w) => ({
    id: String(w.id || newId('w')),
    a: { x: num(w.a?.x, 0), y: num(w.a?.y, 0) },
    b: { x: num(w.b?.x, 0), y: num(w.b?.y, 0) },
    thickness: num(w.thickness, plan.defaults.wallThickness),
    height: num(w.height, plan.defaults.wallHeight),
  })).filter((w) => wallLength(w) > 0);
  plan.openings = (Array.isArray(input.openings) ? input.openings : []).map((o) => {
    const type = o.type === 'window' ? 'window' : 'door';
    const d = OPENING_DEFAULTS[type];
    return {
      id: String(o.id || newId('o')),
      wallId: String(o.wallId),
      type,
      offset: num(o.offset, 0),
      width: num(o.width, d.width),
      height: num(o.height, d.height),
      sill: num(o.sill, d.sill),
    };
  });
  return tidyOpenings(plan);
}

// A small two-room house: 8 m × 6 m outside walls, one partition.
export function samplePlan() {
  const ext = 250;
  const int = 120;
  const h = 2700;
  const wall = (id, ax, ay, bx, by, t) => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: t, height: h });
  const plan = emptyPlan();
  plan.defaults = { wallHeight: h, wallThickness: ext };
  plan.walls = [
    wall('north', 0, 0, 8000, 0, ext),
    wall('east', 8000, 0, 8000, 6000, ext),
    wall('south', 8000, 6000, 0, 6000, ext),
    wall('west', 0, 6000, 0, 0, ext),
    wall('partition', 4500, 0, 4500, 6000, int),
  ];
  const op = (id, wallId, type, offset, extra = {}) => ({ id, wallId, type, offset, ...OPENING_DEFAULTS[type], ...extra });
  plan.openings = [
    op('front-door', 'south', 'door', 2000, { width: 1000 }),
    op('n-win-1', 'north', 'window', 2200, { width: 1600 }),
    op('n-win-2', 'north', 'window', 6250, { width: 1200 }),
    op('e-win', 'east', 'window', 3000, { width: 1800 }),
    op('w-win', 'west', 'window', 3000, { width: 1200 }),
    op('inner-door', 'partition', 'door', 4300, { width: 800 }),
  ];
  return tidyOpenings(plan);
}
