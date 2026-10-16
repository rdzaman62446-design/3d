import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';

export function themeColors() {
  return {
    background: token('--viewer-bg'),
    model: token('--model'),
    edge: token('--model-edge'),
    floor: token('--model-floor'),
    grid: token('--grid-major'),
    gridMinor: token('--grid-minor'),
  };
}

// Units throughout are millimetres.
export class Viewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 10, 200000);
    this.camera.position.set(4000, 3000, 5000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a949c, 1.6));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sun.position.set(0.6, 1, 0.8);
    this.scene.add(this.sun);
    this.fill = new THREE.DirectionalLight(0xffffff, 0.5);
    this.fill.position.set(-0.8, 0.4, -0.6);
    this.scene.add(this.fill);

    this.object = null;
    this.grid = null;
    this.wireframe = false;
    this.applyTheme();

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const loop = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  applyTheme() {
    this.colors = themeColors();
    this.scene.background = new THREE.Color(this.colors.background);
    if (this.object) this.object.traverse((o) => this.styleMesh(o));
    this.rebuildGrid();
  }

  styleMesh(o) {
    if (o.isMesh) {
      o.material.color.set(o.userData.role === 'floor' ? this.colors.floor : this.colors.model);
      o.material.wireframe = this.wireframe;
    }
    if (o.isLineSegments) {
      o.material.color.set(this.colors.edge);
      o.visible = !this.wireframe;
    }
  }

  // Replaces what is on screen. `object` holds meshes tagged with userData.role.
  setObject(object, { fit = false } = {}) {
    if (this.object) {
      this.scene.remove(this.object);
      disposeTree(this.object);
    }
    this.object = object;
    if (object) {
      object.traverse((o) => this.styleMesh(o));
      this.scene.add(object);
    }
    this.rebuildGrid();
    if (fit) this.fit();
  }

  bounds() {
    if (!this.object) return null;
    const box = new THREE.Box3().setFromObject(this.object);
    return box.isEmpty() ? null : box;
  }

  rebuildGrid() {
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      this.grid.material.dispose();
    }
    const box = this.bounds();
    const span = box ? Math.max(box.max.x - box.min.x, box.max.z - box.min.z) : 4000;
    const cell = [100, 250, 500, 1000, 2500, 5000].find((c) => span / c <= 24) || 10000;
    const size = Math.ceil((span * 1.8) / cell / 2) * 2 * cell;
    this.grid = new THREE.GridHelper(size, size / cell, this.colors.grid, this.colors.gridMinor);
    if (box) this.grid.position.set((box.min.x + box.max.x) / 2, Math.min(0, box.min.y) - 1, (box.min.z + box.max.z) / 2);
    this.grid.userData.cell = cell;
    this.scene.add(this.grid);
  }

  fit() {
    const box = this.bounds();
    if (!box) return;
    const centre = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const dist = (radius / Math.sin(Math.min(vfov, hfov) / 2)) * 1.05;
    const dir = new THREE.Vector3(0.75, 0.6, 1).normalize();
    this.camera.position.copy(centre).addScaledVector(dir, dist);
    this.camera.near = Math.max(1, dist / 200);
    this.camera.far = dist * 50;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(centre);
    this.controls.update();
  }

  setWireframe(on) {
    this.wireframe = on;
    if (this.object) this.object.traverse((o) => this.styleMesh(o));
  }

  // Meshes only; edge lines are display aids and are left out of exports.
  exportGroup() {
    const group = new THREE.Group();
    if (!this.object) return group;
    this.object.updateMatrixWorld(true);
    this.object.traverse((o) => {
      if (!o.isMesh) return;
      const mesh = new THREE.Mesh(o.geometry.clone().applyMatrix4(o.matrixWorld), new THREE.MeshStandardMaterial({ color: o.material.color.clone() }));
      mesh.name = o.userData.role || 'model';
      group.add(mesh);
    });
    return group;
  }

  async export(format, basename) {
    const group = this.exportGroup();
    if (!group.children.length) throw new Error('There is no model to export yet.');
    let blob;
    if (format === 'stl') {
      const data = new STLExporter().parse(group, { binary: true });
      blob = new Blob([data], { type: 'model/stl' });
    } else if (format === 'obj') {
      blob = new Blob([`# Draft3D export, units: millimetres\n${new OBJExporter().parse(group)}`], { type: 'text/plain' });
    } else {
      group.scale.setScalar(0.001); // glTF uses metres
      const data = await new GLTFExporter().parseAsync(group, { binary: true });
      blob = new Blob([data], { type: 'model/gltf-binary' });
    }
    disposeTree(group);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${basename}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return blob.size;
  }
}

export function disposeTree(root) {
  root.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) [].concat(o.material).forEach((m) => m.dispose());
  });
}

export function meshFromArrays(positions, indices, role = 'model') {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0 }));
  mesh.userData.role = role;
  return mesh;
}
