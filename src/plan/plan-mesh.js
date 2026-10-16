import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { planBoxes, floorBox } from './build3d.js';

function boxGeometry(b) {
  const g = new THREE.BoxGeometry(b.sx, b.sy, b.sz);
  const m = new THREE.Matrix4().makeRotationY(b.angle).setPosition(b.x, b.y, b.z);
  return g.applyMatrix4(m);
}

export function buildPlanObject(plan) {
  const group = new THREE.Group();
  const boxes = planBoxes(plan);
  if (boxes.length) {
    const walls = mergeGeometries(boxes.map(boxGeometry), false);
    const mesh = new THREE.Mesh(walls, new THREE.MeshStandardMaterial({ roughness: 0.85 }));
    mesh.userData.role = 'walls';
    group.add(mesh);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(walls, 30), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55 }));
    group.add(edges);
  }
  const fb = floorBox(plan);
  if (fb) {
    const floor = new THREE.Mesh(boxGeometry(fb), new THREE.MeshStandardMaterial({ roughness: 0.95 }));
    floor.userData.role = 'floor';
    group.add(floor);
  }
  const triangles = group.children.reduce((n, o) => n + (o.isMesh ? o.geometry.index.count / 3 : 0), 0);
  return { object: group, triangles, boxes: boxes.length };
}
