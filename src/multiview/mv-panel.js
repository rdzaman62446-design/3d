import { VIEW_ORDER } from './carve-core.js';
import { loadImage, imageToMask, drawMask } from './mask.js';
import { drawFigureView, figureSize } from './sample-figure.js';

const LABELS = { front: 'Front', back: 'Back', left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom' };
const NOTES = {
  front: 'Facing you',
  back: 'From behind',
  left: 'From your left',
  right: 'From your right',
  top: 'From above, front edge at the bottom',
  bottom: 'From below, front edge at the top',
};

function cssColorToRgb(color) {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

const $ = (id) => document.getElementById(id);

export class MultiViewPanel {
  constructor({ slotsEl, onResult, onStatus, toast }) {
    this.onResult = onResult;
    this.onStatus = onStatus;
    this.toast = toast;
    this.sources = {};
    this.masks = {};
    this.jobId = 0;
    this.timer = null;
    this.worker = new Worker(new URL('./carve.worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.onWorker(e.data);

    this.slots = {};
    for (const view of VIEW_ORDER) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.dataset.view = view;
      slot.innerHTML = `
        <div class="slot-head"><span class="slot-name">${LABELS[view]}</span><button type="button" class="slot-clear" aria-label="Remove ${LABELS[view]} view" hidden>×</button></div>
        <label class="slot-drop" for="mv-file-${view}">
          <canvas width="160" height="120" aria-hidden="true"></canvas>
          <span class="slot-empty">Add drawing</span>
        </label>
        <input type="file" id="mv-file-${view}" accept="image/*" class="visually-hidden">
        <span class="slot-note">${NOTES[view]}</span>`;
      slotsEl.appendChild(slot);
      const input = slot.querySelector('input');
      input.addEventListener('change', () => {
        if (input.files[0]) this.addFile(view, input.files[0]);
        input.value = '';
      });
      slot.querySelector('.slot-clear').addEventListener('click', () => this.clearView(view));
      slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('is-over'); });
      slot.addEventListener('dragleave', () => slot.classList.remove('is-over'));
      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        slot.classList.remove('is-over');
        const file = e.dataTransfer.files[0];
        if (file) this.addFile(view, file);
      });
      this.slots[view] = slot;
    }

    for (const id of ['mv-threshold', 'mv-invert', 'mv-fill']) $(id).addEventListener('input', () => this.reprocess());
    for (const id of ['mv-height', 'mv-width', 'mv-depth', 'mv-resolution', 'mv-smoothing']) $(id).addEventListener('input', () => this.schedule());
    $('mv-derive').addEventListener('change', () => this.schedule());
    $('mv-sample').addEventListener('click', () => this.loadSample());
    $('mv-clear').addEventListener('click', () => {
      for (const v of VIEW_ORDER) this.clearView(v, false);
      this.schedule();
    });
    $('mv-threshold').addEventListener('input', () => { $('mv-threshold-out').textContent = `${Math.round($('mv-threshold').value * 100)}%`; });
    $('mv-smoothing').addEventListener('input', () => { $('mv-smoothing-out').textContent = $('mv-smoothing').value; });
  }

  settings() {
    return {
      threshold: Number($('mv-threshold').value),
      invert: $('mv-invert').checked,
      fill: $('mv-fill').checked,
    };
  }

  async addFile(view, file) {
    try {
      const img = await loadImage(file);
      this.sources[view] = { img, name: file.name };
      this.processView(view);
      this.schedule();
    } catch (err) {
      this.toast(err.message);
    }
  }

  processView(view) {
    const src = this.sources[view];
    const mask = src ? imageToMask(src.img, this.settings()) : null;
    if (src && !mask) this.toast(`No drawing found in the ${LABELS[view].toLowerCase()} view. Try a higher threshold or turn on Invert.`);
    if (mask) this.masks[view] = mask;
    else delete this.masks[view];
    this.drawSlot(view);
  }

  reprocess() {
    for (const v of Object.keys(this.sources)) this.processView(v);
    this.schedule();
  }

  clearView(view, reschedule = true) {
    delete this.sources[view];
    delete this.masks[view];
    this.drawSlot(view);
    if (reschedule) this.schedule();
  }

  drawSlot(view) {
    const slot = this.slots[view];
    const mask = this.masks[view];
    const color = cssColorToRgb(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    drawMask(slot.querySelector('canvas'), mask, color);
    slot.classList.toggle('has-mask', Boolean(mask));
    slot.querySelector('.slot-clear').hidden = !this.sources[view];
    slot.querySelector('.slot-empty').hidden = Boolean(mask);
    slot.title = this.sources[view]?.name || '';
  }

  redrawAll() {
    for (const v of VIEW_ORDER) this.drawSlot(v);
  }

  loadSample() {
    this.sources = {};
    this.masks = {};
    for (const view of ['front', 'right', 'top']) {
      this.sources[view] = { img: drawFigureView(view), name: `sample-${view}.png` };
    }
    $('mv-height').value = figureSize().y;
    $('mv-derive').checked = true;
    this.reprocess();
    this.redrawAll();
  }

  // Real size in mm. With "derive" on, width and depth come from the drawings'
  // proportions, which holds when every view is drawn at the same scale.
  size() {
    const H = Number($('mv-height').value);
    const manual = { x: Number($('mv-width').value), y: H, z: Number($('mv-depth').value) };
    const derive = $('mv-derive').checked;
    $('mv-width').disabled = derive;
    $('mv-depth').disabled = derive;
    const m = this.masks;
    const fr = m.front || m.back;
    const sd = m.left || m.right;
    const tp = m.top || m.bottom;
    let warning = '';
    if (!derive) return { size: manual, warning };
    let x = fr ? (H * fr.width) / fr.height : null;
    let z = sd ? (H * sd.width) / sd.height : null;
    if (tp) {
      if (x != null && z != null) {
        const expected = z / x;
        const actual = tp.height / tp.width;
        const off = Math.abs(actual / expected - 1);
        if (off > 0.08) warning = `The top view's proportions differ from the front and side views by ${Math.round(off * 100)}%. Check that every drawing uses the same scale.`;
      } else if (x != null) z = (x * tp.height) / tp.width;
      else if (z != null) x = (z * tp.width) / tp.height;
    }
    const size = { x: Math.round(x ?? manual.x), y: H, z: Math.round(z ?? manual.z) };
    $('mv-width').value = size.x;
    $('mv-depth').value = size.z;
    return { size, warning };
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), 180);
  }

  run() {
    const views = Object.keys(this.masks);
    const { size, warning } = this.size();
    $('mv-warning').textContent = warning;
    $('mv-warning').hidden = !warning;
    if (!views.length) {
      this.onResult(null);
      this.onStatus('Add at least one view, or load the sample figure.');
      return;
    }
    const id = ++this.jobId;
    this.onStatus('Carving…');
    this.worker.postMessage({
      id,
      job: {
        masks: this.masks,
        size,
        resolution: Number($('mv-resolution').value),
        smoothing: Number($('mv-smoothing').value),
      },
    });
  }

  onWorker({ id, ok, result, error }) {
    if (id !== this.jobId) return;
    if (!ok) {
      this.onStatus(error);
      this.onResult(null);
      return;
    }
    const g = result.grid;
    const tris = result.indices.length / 3;
    this.onStatus(`${result.views.length} view${result.views.length > 1 ? 's' : ''} · grid ${g.x}×${g.y}×${g.z} · ${tris.toLocaleString()} triangles · ${Math.round(result.ms)} ms`);
    this.onResult(result);
  }
}
