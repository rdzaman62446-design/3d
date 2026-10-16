// A standing figure in an A-pose, built from simple solids so that the front,
// side and top drawings are exact projections of the same body.

const mirror = (prims) => prims.flatMap((p) => [p, flipX(p)]);
function flipX(p) {
  if (p.kind === 'ellipsoid') return { ...p, c: [-p.c[0], p.c[1], p.c[2]] };
  return { ...p, a: [-p.a[0], p.a[1], p.a[2]], b: [-p.b[0], p.b[1], p.b[2]] };
}
const ell = (c, r) => ({ kind: 'ellipsoid', c, r });
const cap = (a, b, r) => ({ kind: 'capsule', a, b, r });

const PRIMS = [
  ell([0, 1640, 0], [92, 112, 102]), // head
  cap([0, 1470, 0], [0, 1560, 0], 52), // neck
  ell([0, 1260, 0], [175, 250, 112]), // chest
  ell([0, 975, 0], [165, 125, 108]), // pelvis
  ...mirror([
    cap([170, 1400, 0], [310, 1160, -10], 46), // upper arm
    cap([310, 1160, -10], [400, 900, 10], 37), // forearm
    ell([425, 820, 15], [36, 70, 28]), // hand
    cap([88, 930, 0], [102, 510, 15], 72), // thigh
    cap([102, 510, 15], [106, 95, -5], 48), // shin
    cap([106, 45, -40], [112, 40, 150], 42), // foot, toes toward the front
  ]),
];

const AX = { x: 0, y: 1, z: 2 };
// Image u/v for each view, matching VIEW_SPECS in carve-core.js.
const VIEWS = {
  front: { u: ['x', 1], v: ['y', -1] },
  right: { u: ['z', -1], v: ['y', -1] },
  top: { u: ['x', 1], v: ['z', 1] },
};

function extents(view) {
  const [ua, us] = view.u;
  const [va, vs] = view.v;
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const p of PRIMS) {
    const pts = p.kind === 'ellipsoid' ? [p.c] : [p.a, p.b];
    const ru = p.kind === 'ellipsoid' ? p.r[AX[ua]] : p.r;
    const rv = p.kind === 'ellipsoid' ? p.r[AX[va]] : p.r;
    for (const q of pts) {
      const u = q[AX[ua]] * us;
      const v = q[AX[va]] * vs;
      u0 = Math.min(u0, u - ru);
      u1 = Math.max(u1, u + ru);
      v0 = Math.min(v0, v - rv);
      v1 = Math.max(v1, v + rv);
    }
  }
  return { u0, u1, v0, v1 };
}

export function figureSize() {
  const f = extents(VIEWS.front);
  const s = extents(VIEWS.right);
  return { x: Math.round(f.u1 - f.u0), y: Math.round(f.v1 - f.v0), z: Math.round(s.u1 - s.u0) };
}

// Draws one view the way a reference sheet would: filled figure, a centre line
// and an overall dimension. The carving keeps only the figure itself.
export function drawFigureView(name, px = 720) {
  const view = VIEWS[name];
  const e = extents(view);
  const margin = 70;
  const k = (px - margin * 2) / Math.max(e.u1 - e.u0, e.v1 - e.v0);
  const w = Math.round((e.u1 - e.u0) * k + margin * 2);
  const h = Math.round((e.v1 - e.v0) * k + margin * 2);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  const U = (q) => (q[AX[view.u[0]]] * view.u[1] - e.u0) * k + margin;
  const V = (q) => (q[AX[view.v[0]]] * view.v[1] - e.v0) * k + margin;
  ctx.fillStyle = '#2b333c';
  ctx.strokeStyle = '#2b333c';
  ctx.lineCap = 'round';
  for (const p of PRIMS) {
    if (p.kind === 'ellipsoid') {
      ctx.beginPath();
      ctx.ellipse(U(p.c), V(p.c), p.r[AX[view.u[0]]] * k, p.r[AX[view.v[0]]] * k, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.lineWidth = p.r * 2 * k;
      ctx.beginPath();
      ctx.moveTo(U(p.a), V(p.a));
      ctx.lineTo(U(p.b), V(p.b));
      ctx.stroke();
    }
  }
  // Overall width dimension below the figure, kept clear of it.
  const y = h - margin / 2;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#5b6773';
  ctx.beginPath();
  ctx.moveTo(margin, y);
  ctx.lineTo(w - margin, y);
  for (const x of [margin, w - margin]) {
    ctx.moveTo(x, y - 8);
    ctx.lineTo(x, y + 8);
  }
  ctx.stroke();
  ctx.fillStyle = '#5b6773';
  ctx.font = '14px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`${Math.round(e.u1 - e.u0)}`, w / 2, y - 6);
  ctx.fillText(name.toUpperCase(), w / 2, margin / 2);
  return canvas;
}
