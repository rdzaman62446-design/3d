// Silhouette carving (a "visual hull"): start from a solid block and keep only
// the voxels that fall inside the silhouette of every view provided. The result
// is turned into a closed triangle mesh with surface nets.
//
// Model axes: x to the right, y up, z toward the viewer of the front view.
// Each view says which model axis its image u (left→right) and v (top→bottom)
// run along, and whether that axis is mirrored.
export const VIEW_SPECS = {
  front: { u: 'x', flipU: false, v: 'y', flipV: true },
  back: { u: 'x', flipU: true, v: 'y', flipV: true },
  left: { u: 'z', flipU: false, v: 'y', flipV: true },
  right: { u: 'z', flipU: true, v: 'y', flipV: true },
  top: { u: 'x', flipU: false, v: 'z', flipV: false },
  bottom: { u: 'x', flipU: false, v: 'z', flipV: true },
};

export const VIEW_ORDER = ['front', 'back', 'left', 'right', 'top', 'bottom'];

const AXIS = { x: 0, y: 1, z: 2 };

function summedArea(mask) {
  const { width: w, height: h, data } = mask;
  const W = w + 1;
  const sat = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += data[y * w + x];
      sat[(y + 1) * W + x + 1] = sat[y * W + x + 1] + row;
    }
  }
  return sat;
}

// Fraction of each grid cell (nu × nv over the whole image) covered by the mask.
export function coverageTable(mask, nu, nv, flipU, flipV) {
  const { width: w, height: h } = mask;
  const sat = summedArea(mask);
  const W = w + 1;
  const table = new Float32Array(nu * nv);
  const span = (i, n, size, flip) => {
    let t0 = i / n;
    let t1 = (i + 1) / n;
    if (flip) [t0, t1] = [1 - t1, 1 - t0];
    const p0 = Math.min(size - 1, Math.floor(t0 * size));
    const p1 = Math.min(size, Math.max(p0 + 1, Math.ceil(t1 * size - 1e-9)));
    return [p0, p1];
  };
  for (let iv = 0; iv < nv; iv++) {
    const [y0, y1] = span(iv, nv, h, flipV);
    for (let iu = 0; iu < nu; iu++) {
      const [x0, x1] = span(iu, nu, w, flipU);
      const sum = sat[y1 * W + x1] - sat[y0 * W + x1] - sat[y1 * W + x0] + sat[y0 * W + x0];
      table[iv * nu + iu] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return table;
}

function blur(field, dims, passes) {
  const tmp = new Float32Array(field.length);
  const strides = [1, dims[0], dims[0] * dims[1]];
  for (let pass = 0; pass < passes; pass++) {
    for (let axis = 0; axis < 3; axis++) {
      const stride = strides[axis];
      const len = dims[axis];
      for (let i = 0; i < field.length; i++) {
        const c = Math.floor(i / stride) % len;
        const a = c > 0 ? field[i - stride] : field[i];
        const b = c < len - 1 ? field[i + stride] : field[i];
        tmp[i] = 0.25 * a + 0.5 * field[i] + 0.25 * b;
      }
      field.set(tmp);
    }
  }
}

const CUBE_EDGES = [];
for (let i = 0; i < 8; i++) {
  for (let j = 0; j < 3; j++) {
    const k = i ^ (1 << j);
    if (i < k) CUBE_EDGES.push([i, k]);
  }
}

// Surface nets: one vertex per cell the surface passes through, one quad per
// grid edge that crosses the iso level. Faces wind counter-clockwise when seen
// from outside (values above `iso` are inside).
export function surfaceNets(field, dims, iso = 0.5) {
  const [NX, NY, NZ] = dims;
  const strides = [1, NX, NX * NY];
  const offsets = [0, 1, NX, 1 + NX, NX * NY, 1 + NX * NY, NX + NX * NY, 1 + NX + NX * NY];
  const vertexAt = new Int32Array(field.length).fill(-1);
  const corner = new Float32Array(8);
  const pos = [];

  for (let z = 0; z < NZ - 1; z++) {
    for (let y = 0; y < NY - 1; y++) {
      for (let x = 0; x < NX - 1; x++) {
        const i = x + y * NX + z * NX * NY;
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = field[i + offsets[c]];
          corner[c] = v;
          if (v > iso) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let px = 0;
        let py = 0;
        let pz = 0;
        let count = 0;
        for (const [a, b] of CUBE_EDGES) {
          if (((mask >> a) & 1) === ((mask >> b) & 1)) continue;
          const t = (iso - corner[a]) / (corner[b] - corner[a]);
          px += (a & 1) + t * ((b & 1) - (a & 1));
          py += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1));
          pz += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1));
          count++;
        }
        vertexAt[i] = pos.length / 3;
        pos.push(x + px / count, y + py / count, z + pz / count);
      }
    }
  }

  const idx = [];
  const p = [0, 0, 0];
  for (let z = 0; z < NZ; z++) {
    for (let y = 0; y < NY; y++) {
      for (let x = 0; x < NX; x++) {
        const i = x + y * NX + z * NX * NY;
        p[0] = x;
        p[1] = y;
        p[2] = z;
        const inside = field[i] > iso;
        for (let a = 0; a < 3; a++) {
          if (p[a] >= dims[a] - 1) continue;
          const b = (a + 1) % 3;
          const c = (a + 2) % 3;
          if (p[b] < 1 || p[c] < 1 || p[b] > dims[b] - 2 || p[c] > dims[c] - 2) continue;
          if (inside === field[i + strides[a]] > iso) continue;
          const q0 = vertexAt[i];
          const q1 = vertexAt[i - strides[b]];
          const q2 = vertexAt[i - strides[b] - strides[c]];
          const q3 = vertexAt[i - strides[c]];
          if (q0 < 0 || q1 < 0 || q2 < 0 || q3 < 0) continue;
          if (inside) idx.push(q0, q1, q2, q0, q2, q3);
          else idx.push(q0, q2, q1, q0, q3, q2);
        }
      }
    }
  }

  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

// masks: { front?: {width, height, data: Uint8Array of 0/1}, ... }, each cropped
// tightly to the drawing so that it spans the model's full extent.
// size: real dimensions in mm { x: width, y: height, z: depth }.
export function carve({ masks, size, resolution = 128, smoothing = 1 }) {
  const views = VIEW_ORDER.filter((k) => masks[k]);
  if (!views.length) throw new Error('Add at least one view to carve a model.');
  for (const k of ['x', 'y', 'z']) {
    if (!(size[k] > 0)) throw new Error('Width, height and depth must all be above zero.');
  }

  const longest = Math.max(size.x, size.y, size.z);
  const n = [size.x, size.y, size.z].map((s) => Math.max(2, Math.round((s / longest) * resolution)));
  const pad = smoothing + 1;
  const dims = n.map((v) => v + 2 * pad);
  const [NX, NY] = dims;

  const tables = views.map((k) => {
    const s = VIEW_SPECS[k];
    const ua = AXIS[s.u];
    const va = AXIS[s.v];
    return { ua, va, nu: n[ua], table: coverageTable(masks[k], n[ua], n[va], s.flipU, s.flipV) };
  });

  const field = new Float32Array(dims[0] * dims[1] * dims[2]);
  const c = [0, 0, 0];
  let filled = 0;
  for (let iz = 0; iz < n[2]; iz++) {
    c[2] = iz;
    for (let iy = 0; iy < n[1]; iy++) {
      c[1] = iy;
      for (let ix = 0; ix < n[0]; ix++) {
        c[0] = ix;
        let v = 1;
        for (const t of tables) {
          const cov = t.table[c[t.va] * t.nu + c[t.ua]];
          if (cov < v) v = cov;
          if (v <= 0) break;
        }
        if (v > 0) {
          field[ix + pad + (iy + pad) * NX + (iz + pad) * NX * NY] = v;
          if (v > 0.5) filled++;
        }
      }
    }
  }

  if (smoothing > 0) blur(field, dims, smoothing);
  const mesh = surfaceNets(field, dims, 0.5);

  const step = [size.x / n[0], size.y / n[1], size.z / n[2]];
  const shift = [-size.x / 2, 0, -size.z / 2];
  const P = mesh.positions;
  for (let i = 0; i < P.length; i += 3) {
    for (let a = 0; a < 3; a++) P[i + a] = (P[i + a] - pad + 0.5) * step[a] + shift[a];
  }

  return {
    positions: P,
    indices: mesh.indices,
    grid: { x: n[0], y: n[1], z: n[2] },
    filledVoxels: filled,
    views,
  };
}
