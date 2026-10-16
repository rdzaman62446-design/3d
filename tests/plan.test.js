import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBoxes, floorBox } from '../src/plan/build3d.js';
import { samplePlan, emptyPlan, setWallLength, normalizePlan } from '../src/plan/model.js';

const wall = (id, ax, ay, bx, by) => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 200, height: 2700 });

test('a plain wall becomes one box with square ends', () => {
  const plan = emptyPlan();
  plan.walls = [wall('w', 0, 0, 4000, 0)];
  const [box] = planBoxes(plan);
  assert.equal(box.sx, 4200);
  assert.equal(box.sy, 2700);
  assert.equal(box.sz, 200);
  assert.equal(box.x, 2000);
  assert.equal(box.y, 1350);
});

test('a window leaves wall below and above it', () => {
  const plan = emptyPlan();
  plan.walls = [wall('w', 0, 0, 4000, 0)];
  plan.openings = [{ id: 'o', wallId: 'w', type: 'window', offset: 2000, width: 1000, height: 1200, sill: 900 }];
  const boxes = planBoxes(plan);
  assert.equal(boxes.length, 4);
  const below = boxes.find((b) => b.sy === 900);
  const above = boxes.find((b) => Math.abs(b.y - (2100 + 2700) / 2) < 1e-6);
  assert.ok(below && above);
  assert.equal(below.sx, 1000);
  assert.equal(above.sy, 600);
});

test('a door leaves only the lintel above it', () => {
  const plan = emptyPlan();
  plan.walls = [wall('w', 0, 0, 4000, 0)];
  plan.openings = [{ id: 'o', wallId: 'w', type: 'door', offset: 1000, width: 900, height: 2100, sill: 0 }];
  assert.equal(planBoxes(plan).length, 3);
});

test('vertical walls are placed along Z', () => {
  const plan = emptyPlan();
  plan.walls = [wall('w', 0, 0, 0, 3000)];
  const [box] = planBoxes(plan);
  assert.equal(box.x, 0);
  assert.equal(box.z, 1500);
});

test('sample plan builds walls and a floor', () => {
  const plan = samplePlan();
  assert.ok(planBoxes(plan).length > plan.walls.length);
  const floor = floorBox(plan);
  assert.equal(floor.sx, 8250);
  assert.equal(floor.sz, 6250);
});

test('changing a wall length drags the joined wall along', () => {
  const plan = emptyPlan();
  plan.walls = [wall('a', 0, 0, 3000, 0), wall('b', 3000, 0, 3000, 2000)];
  setWallLength(plan, 'a', 4000);
  assert.deepEqual(plan.walls[0].b, { x: 4000, y: 0 });
  assert.deepEqual(plan.walls[1].a, { x: 4000, y: 0 });
});

test('imported files are validated', () => {
  assert.throws(() => normalizePlan({ nope: true }));
  const plan = normalizePlan({ walls: [{ a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } }] });
  assert.equal(plan.walls.length, 1);
  assert.equal(plan.walls[0].height, 2700);
});
