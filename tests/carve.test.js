import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carve } from '../src/multiview/carve-core.js';

function circleMask(size) {
  const data = new Uint8Array(size * size);
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((x + 0.5 - r) ** 2 + (y + 0.5 - r) ** 2 <= r * r) data[y * size + x] = 1;
    }
  }
  return { width: size, height: size, data };
}

function rectMask(w, h) {
  return { width: w, height: h, data: new Uint8Array(w * h).fill(1) };
}

function bounds(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], positions[i + a]);
      max[a] = Math.max(max[a], positions[i + a]);
    }
  }
  return { min, max };
}

test('a box carved from three rectangles has the requested size', () => {
  const r = carve({
    masks: { front: rectMask(40, 20), right: rectMask(10, 20), top: rectMask(40, 10) },
    size: { x: 400, y: 200, z: 100 },
    resolution: 40,
    smoothing: 0,
  });
  const { min, max } = bounds(r.positions);
  assert.ok(Math.abs(max[0] - min[0] - 400) < 1, `width ${max[0] - min[0]}`);
  assert.ok(Math.abs(max[1] - min[1] - 200) < 1, `height ${max[1] - min[1]}`);
  assert.ok(Math.abs(max[2] - min[2] - 100) < 1, `depth ${max[2] - min[2]}`);
  assert.ok(Math.abs(min[1]) < 1, 'sits on the ground');
});

test('carved mesh is closed and faces point outward', () => {
  const m = circleMask(64);
  const r = carve({ masks: { front: m, right: m, top: m }, size: { x: 100, y: 100, z: 100 }, resolution: 48, smoothing: 1 });
  const P = r.positions;
  const I = r.indices;
  assert.ok(I.length > 0);

  const edges = new Map();
  for (let t = 0; t < I.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = I[t + e];
      const b = I[t + ((e + 1) % 3)];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  for (const count of edges.values()) assert.equal(count, 2);

  let outward = 0;
  const cy = 50;
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t] * 3, I[t + 1] * 3, I[t + 2] * 3];
    const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
    const v = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const centre = [(P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3 - cy, (P[a + 2] + P[b + 2] + P[c + 2]) / 3];
    outward += n[0] * centre[0] + n[1] * centre[1] + n[2] * centre[2] > 0 ? 1 : -1;
  }
  assert.ok(outward > (I.length / 3) * 0.95, 'nearly all faces point away from the centre');
});

test('an empty view set is rejected', () => {
  assert.throws(() => carve({ masks: {}, size: { x: 1, y: 1, z: 1 } }));
});
