import '../styles/base.css';
import '../styles/app.css';
import { Viewer, meshFromArrays } from './viewer.js';
import { initTheme } from './theme.js';
import { History } from '../plan/history.js';
import { PlanEditor } from '../plan/editor.js';
import { setupPlanPanel } from '../plan/plan-panel.js';
import { buildPlanObject } from '../plan/plan-mesh.js';
import { normalizePlan, samplePlan } from '../plan/model.js';
import { MultiViewPanel } from '../multiview/mv-panel.js';
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'draft3d-plan';

function loadPlan() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) return normalizePlan(JSON.parse(saved));
  } catch { /* fall back to the sample */ }
  return samplePlan();
}

let toastTimer;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
}

const workspace = $('workspace');
const viewer = new Viewer($('viewer'));
const history = new History(loadPlan());
let mode = location.hash === '#multiview' ? 'multiview' : 'plan';
const fitted = { plan: false, multiview: false };
let mvResult = null;
const status = { plan: '', multiview: 'Loading sample figure…' };

const editor = new PlanEditor($('plan-canvas'), history, { isActive: () => mode === 'plan' });
setupPlanPanel({ editor, history, toast });

const mv = new MultiViewPanel({
  slotsEl: $('mv-slots'),
  toast,
  onStatus: (text) => {
    status.multiview = text;
    if (mode === 'multiview') $('status').textContent = text;
  },
  onResult: (result) => {
    mvResult = result;
    if (mode === 'multiview') showModel();
  },
});

function updateReadout() {
  const box = viewer.bounds();
  const empty = $('viewer-empty');
  if (!box) {
    $('readout').textContent = '';
    empty.hidden = false;
    empty.textContent = mode === 'plan' ? 'Draw a wall to see it in 3D.' : 'Add a drawing on the left, or load the sample figure.';
    return;
  }
  empty.hidden = true;
  const s = box.getSize(new THREE.Vector3());
  const r = (v) => Math.round(v).toLocaleString();
  $('readout').innerHTML = `<span>W ${r(s.x)}</span><span>D ${r(s.z)}</span><span>H ${r(s.y)}</span><span class="unit">mm</span>`;
}

function showModel() {
  if (mode === 'plan') {
    const built = buildPlanObject(history.state);
    const p = history.state;
    status.plan = `${p.walls.length} walls · ${p.openings.length} openings · ${built.triangles.toLocaleString()} triangles`;
    viewer.setObject(built.object.children.length ? built.object : null, { fit: !fitted.plan });
    if (built.object.children.length) fitted.plan = true;
  } else {
    let object = null;
    if (mvResult?.indices.length) {
      object = new THREE.Group();
      object.add(meshFromArrays(mvResult.positions.slice(), mvResult.indices.slice()));
    }
    viewer.setObject(object, { fit: !fitted.multiview });
    if (object) fitted.multiview = true;
  }
  $('status').textContent = status[mode];
  updateReadout();
}

let rebuildTimer;
history.subscribe((state) => {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
  if (mode !== 'plan') return;
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(showModel, 60);
});

function setMode(next) {
  mode = next;
  workspace.dataset.mode = mode;
  document.querySelectorAll('[data-mode]').forEach((b) => {
    if (b.tagName === 'BUTTON') b.setAttribute('aria-selected', String(b.dataset.mode === mode));
  });
  $('panel-plan').hidden = mode !== 'plan';
  $('panel-mv').hidden = mode !== 'multiview';
  $('editor-wrap').hidden = mode !== 'plan';
  if (location.hash !== `#${mode}`) history_replace(`#${mode}`);
  showModel();
  if (mode === 'plan') editor.resize();
}

function history_replace(hash) {
  try { window.history.replaceState(null, '', hash); } catch { /* sandboxed frames */ }
}

document.querySelectorAll('button[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
window.addEventListener('hashchange', () => setMode(location.hash === '#multiview' ? 'multiview' : 'plan'));

for (const format of ['stl', 'obj', 'glb']) {
  $(`export-${format}`).addEventListener('click', async () => {
    try {
      const bytes = await viewer.export(format, mode === 'plan' ? 'draft3d-floor-plan' : 'draft3d-multiview');
      toast(`Exported ${format.toUpperCase()} (${(bytes / 1024).toFixed(0)} KB, millimetres${format === 'glb' ? ' converted to metres' : ''}).`);
    } catch (err) {
      toast(err.message);
    }
  });
}

$('fit-view').addEventListener('click', () => viewer.fit());
$('toggle-wire').addEventListener('click', (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(on));
  viewer.setWireframe(on);
});

initTheme($('theme-toggle'), () => {
  viewer.applyTheme();
  editor.refreshTheme();
  mv.redrawAll();
});

mv.loadSample();
setMode(mode);
