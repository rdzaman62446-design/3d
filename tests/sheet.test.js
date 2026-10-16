import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findFigures, guessViews, facing } from '../src/multiview/sheet-core.js';

// Paints rectangles into a sheet; each figure is a list of [x, y, w, h].
function sheet(w, h, rects) {
  const data = new Uint8Array(w * h);
  for (const [x0, y0, rw, rh] of rects) {
    for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) data[y * w + x] = 1;
  }
  return data;
}

// A crude standing body, `bw` wide, with feet sticking out by `toe` pixels.
function body(x, y, bw, toe = 0) {
  const legX = x + Math.floor(bw / 2) - 6;
  const rects = [[x, y, bw, 120], [legX, y + 120, 12, 70]];
  rects.push(toe >= 0 ? [legX, y + 190, 12 + toe, 10] : [legX + toe, y + 190, 12 - toe, 10]);
  return rects;
}

test('finds figures in reading order and ignores labels', () => {
  const rects = [
    ...body(20, 20, 90),
    ...body(160, 20, 30, -14),
    ...body(240, 20, 90),
    ...body(380, 20, 30, 14),
    [40, 240, 30, 6], // a small label under the first figure
  ];
  const figs = findFigures(sheet(460, 260, rects), 460, 260);
  assert.equal(figs.length, 4);
  assert.deepEqual(figs.map((f) => f.box.x), [20, 155, 240, 380]);
});

test('facing reads the direction the feet point', () => {
  const left = findFigures(sheet(80, 220, body(20, 10, 30, -14)), 80, 220)[0];
  const right = findFigures(sheet(80, 220, body(20, 10, 30, 14)), 80, 220)[0];
  assert.ok(facing(left.mask) < 0);
  assert.ok(facing(right.mask) > 0);
});

test('guesses front, sides, back and top', () => {
  const rects = [
    ...body(20, 20, 90),
    ...body(160, 20, 30, -14),
    ...body(240, 20, 90),
    ...body(380, 20, 30, 14),
    [480, 60, 90, 40], // short and wide: a top view
  ];
  const figs = findFigures(sheet(600, 260, rects), 600, 260);
  const views = guessViews(figs).map((g) => g.view);
  assert.deepEqual(views, ['front', 'right', 'back', 'left', 'top']);
});

test('a 3/4 view is skipped', () => {
  const rects = [...body(20, 20, 90), ...body(160, 20, 62)];
  const figs = findFigures(sheet(260, 220, rects), 260, 220);
  assert.deepEqual(guessViews(figs).map((g) => g.view), ['front', 'skip']);
});
