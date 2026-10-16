import { wallLength, wallDir } from './model.js';

export const FLOOR_THICKNESS = 150;

// Splits every wall into solid boxes around its openings.
// Each box: centre (x, y, z) in 3D mm, size along the wall / up / across, and
// rotation about the vertical axis.
export function planBoxes(plan) {
  const boxes = [];
  for (const w of plan.walls) {
    const L = wallLength(w);
    if (L <= 0) continue;
    const d = wallDir(w);
    const t = w.thickness;
    const h = w.height;
    const ext = t / 2; // square ends, so walls overlap cleanly at corners
    const angle = Math.atan2(-d.y, d.x);
    const push = (u0, u1, y0, y1) => {
      if (u1 - u0 < 0.5 || y1 - y0 < 0.5) return;
      const mid = (u0 + u1) / 2;
      boxes.push({
        wallId: w.id,
        x: w.a.x + d.x * mid,
        y: (y0 + y1) / 2,
        z: w.a.y + d.y * mid,
        sx: u1 - u0,
        sy: y1 - y0,
        sz: t,
        angle,
      });
    };
    const ops = plan.openings
      .filter((o) => o.wallId === w.id)
      .map((o) => ({ u0: o.offset - o.width / 2, u1: o.offset + o.width / 2, sill: o.sill, top: o.sill + o.height }))
      .sort((p, q) => p.u0 - q.u0);
    let cursor = -ext;
    for (const o of ops) {
      const u0 = Math.max(o.u0, cursor);
      if (o.u1 <= u0) continue;
      push(cursor, u0, 0, h);
      push(u0, o.u1, 0, Math.min(o.sill, h));
      push(u0, o.u1, Math.min(o.top, h), h);
      cursor = o.u1;
    }
    push(cursor, L + ext, 0, h);
  }
  return boxes;
}

export function floorBox(plan) {
  if (!plan.floor || !plan.walls.length) return null;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const w of plan.walls) {
    const r = w.thickness / 2;
    for (const p of [w.a, w.b]) {
      minX = Math.min(minX, p.x - r);
      maxX = Math.max(maxX, p.x + r);
      minZ = Math.min(minZ, p.y - r);
      maxZ = Math.max(maxZ, p.y + r);
    }
  }
  return {
    x: (minX + maxX) / 2,
    y: -FLOOR_THICKNESS / 2,
    z: (minZ + maxZ) / 2,
    sx: maxX - minX,
    sy: FLOOR_THICKNESS,
    sz: maxZ - minZ,
    angle: 0,
  };
}
