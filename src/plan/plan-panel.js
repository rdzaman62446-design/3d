import { TOOL_HINTS } from './editor.js';
import { wallLength, setWallLength, clampOpening, normalizePlan, samplePlan, emptyPlan } from './model.js';
import { loadImage } from '../multiview/mask.js';

const $ = (id) => document.getElementById(id);

function numberField(id, label, value, { step = 10, min = 0, unit = 'mm' } = {}) {
  return `<label class="field" for="${id}"><span>${label}</span><span class="input-unit"><input id="${id}" type="number" inputmode="decimal" step="${step}" min="${min}" value="${Math.round(value)}"><em>${unit}</em></span></label>`;
}

export function setupPlanPanel({ editor, history, toast }) {
  const toolButtons = document.querySelectorAll('[data-tool]');
  toolButtons.forEach((b) => b.addEventListener('click', () => editor.setTool(b.dataset.tool)));
  const hint = $('editor-hint');
  editor.hooks.onToolChange = (tool) => {
    toolButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
    hint.textContent = TOOL_HINTS[tool];
  };
  editor.hooks.onToolChange(editor.tool);
  editor.hooks.onMessage = toast;

  // New-wall defaults and model options
  const syncDefaults = () => {
    const p = history.state;
    if (document.activeElement !== $('def-height')) $('def-height').value = p.defaults.wallHeight;
    if (document.activeElement !== $('def-thickness')) $('def-thickness').value = p.defaults.wallThickness;
    $('floor-slab').checked = p.floor;
    $('undo').disabled = !history.undoStack.length;
    $('redo').disabled = !history.redoStack.length;
  };
  $('def-height').addEventListener('change', (e) => {
    const v = Number(e.target.value);
    if (v > 0) history.update((p) => { p.defaults.wallHeight = v; });
  });
  $('def-thickness').addEventListener('change', (e) => {
    const v = Number(e.target.value);
    if (v > 0) history.update((p) => { p.defaults.wallThickness = v; });
  });
  $('grid-snap').addEventListener('change', (e) => { editor.gridSnap = Number(e.target.value); });
  $('floor-slab').addEventListener('change', (e) => history.update((p) => { p.floor = e.target.checked; }));
  $('undo').addEventListener('click', () => history.undo());
  $('redo').addEventListener('click', () => history.redo());

  // Selection properties
  const props = $('sel-props');
  let shownKey = null;
  const renderSelection = () => {
    const sel = editor.selected();
    const key = sel ? `${editor.selection.kind}:${sel.id}` : `none:${history.state.walls.length}:${history.state.openings.length}`;
    if (key === shownKey) {
      // Same item: refresh values without rebuilding the fields being edited.
      props.querySelectorAll('input[data-key]').forEach((input) => {
        if (document.activeElement === input || !sel) return;
        const v = input.dataset.key === 'length' ? wallLength(sel) : sel[input.dataset.key];
        input.value = Math.round(v);
      });
      return;
    }
    shownKey = key;
    if (!sel) {
      const p = history.state;
      props.innerHTML = `<p class="muted">${p.walls.length} walls, ${p.openings.length} doors and windows. Select one to edit its measurements.</p>`;
      return;
    }
    if (editor.selection.kind === 'wall') {
      props.innerHTML = `
        <p class="sel-kind">Wall</p>
        ${numberField('sel-length', 'Length', wallLength(sel))}
        ${numberField('sel-thickness', 'Thickness', sel.thickness)}
        ${numberField('sel-height', 'Height', sel.height)}
        <button type="button" class="btn btn-quiet btn-danger" id="sel-delete">Delete wall</button>`;
      props.querySelector('#sel-length').dataset.key = 'length';
      props.querySelector('#sel-thickness').dataset.key = 'thickness';
      props.querySelector('#sel-height').dataset.key = 'height';
    } else {
      props.innerHTML = `
        <p class="sel-kind">${sel.type === 'door' ? 'Door' : 'Window'}</p>
        <label class="field" for="sel-type"><span>Type</span><select id="sel-type"><option value="door">Door</option><option value="window">Window</option></select></label>
        ${numberField('sel-width', 'Width', sel.width)}
        ${numberField('sel-oheight', 'Height', sel.height)}
        ${numberField('sel-sill', 'Sill height', sel.sill)}
        ${numberField('sel-offset', 'Centre from wall start', sel.offset)}
        <button type="button" class="btn btn-quiet btn-danger" id="sel-delete">Delete ${sel.type}</button>`;
      props.querySelector('#sel-type').value = sel.type;
      props.querySelector('#sel-width').dataset.key = 'width';
      props.querySelector('#sel-oheight').dataset.key = 'height';
      props.querySelector('#sel-sill').dataset.key = 'sill';
      props.querySelector('#sel-offset').dataset.key = 'offset';
      props.querySelector('#sel-type').addEventListener('change', (e) => {
        history.update((p) => {
          const o = p.openings.find((x) => x.id === sel.id);
          o.type = e.target.value;
          if (o.type === 'door') o.sill = 0;
        });
        shownKey = null;
        renderSelection();
      });
    }
    props.querySelector('#sel-delete').addEventListener('click', () => editor.deleteSelection());
    props.querySelectorAll('input[data-key]').forEach((input) => {
      input.addEventListener('change', () => {
        const v = Number(input.value);
        const k = input.dataset.key;
        if (!(v >= 0) || (k !== 'sill' && v <= 0)) return;
        history.update((p) => {
          if (editor.selection.kind === 'wall') {
            if (k === 'length') setWallLength(p, sel.id, v);
            else {
              p.walls.find((w) => w.id === sel.id)[k] = v;
              for (const o of p.openings) if (o.wallId === sel.id) clampOpening(o, p.walls.find((w) => w.id === sel.id));
            }
          } else {
            const o = p.openings.find((x) => x.id === sel.id);
            o[k] = v;
            clampOpening(o, p.walls.find((w) => w.id === o.wallId));
          }
        });
      });
    });
  };
  editor.hooks.onSelect = renderSelection;
  history.subscribe(() => { renderSelection(); syncDefaults(); });
  renderSelection();
  syncDefaults();

  // Tracing a drawing
  const underlayControls = $('underlay-controls');
  $('underlay-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      editor.setUnderlay(await loadImage(file));
      editor.underlay.opacity = Number($('underlay-opacity').value);
      underlayControls.hidden = false;
      editor.setTool('calibrate');
      toast('Drawing added. Click two points a known distance apart to set its scale.');
    } catch (err) {
      toast(err.message);
    }
  });
  $('underlay-opacity').addEventListener('input', (e) => {
    if (editor.underlay) editor.underlay.opacity = Number(e.target.value);
    editor.requestRender();
  });
  $('underlay-calibrate').addEventListener('click', () => editor.setTool('calibrate'));
  $('underlay-remove').addEventListener('click', () => {
    editor.setUnderlay(null);
    underlayControls.hidden = true;
    $('calib-form').hidden = true;
    if (editor.tool === 'calibrate') editor.setTool('select');
  });
  editor.hooks.onCalibrate = (measured) => {
    $('calib-form').hidden = false;
    $('calib-length').value = measured;
    $('calib-length').focus();
    $('calib-length').select();
  };
  $('calib-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = Number($('calib-length').value);
    if (!(v > 0)) return;
    editor.applyCalibration(v);
    $('calib-form').hidden = true;
    toast(`Scale set. Trace the walls with the wall tool.`);
  });

  // Files
  $('plan-sample').addEventListener('click', () => {
    history.commit(samplePlan());
    editor.select(null);
    editor.fit();
  });
  $('plan-new').addEventListener('click', () => {
    const p = emptyPlan();
    p.defaults = { ...history.state.defaults };
    history.commit(p);
    editor.select(null);
    editor.setTool('wall');
  });
  $('plan-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(history.state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'draft3d-plan.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  $('plan-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      history.commit(normalizePlan(JSON.parse(await file.text())));
      editor.select(null);
      editor.fit();
      toast(`Opened ${file.name}.`);
    } catch (err) {
      toast(err instanceof SyntaxError ? `${file.name} is not valid JSON.` : err.message);
    }
  });
}
