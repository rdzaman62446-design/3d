import { VIEW_ORDER } from './carve-core.js';
import { loadImage, imageToMask, drawMask } from './mask.js';
import { drawFigureView, figureSize } from './sample-figure.js';
import { splitSheet, numberedSheet, sampleSheet } from './sheet.js';
import { VIEW_CHOICES } from './sheet-core.js';

const AI_KEY = 'draft3d-anthropic-key';

const LABELS = { front: 'Front', back: 'Back', left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom', skip: 'Skip' };
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
    this.setupSheet();
    $('mv-threshold').addEventListener('input', () => { $('mv-threshold-out').textContent = `${Math.round($('mv-threshold').value * 100)}%`; });
    $('mv-smoothing').addEventListener('input', () => { $('mv-smoothing-out').textContent = $('mv-smoothing').value; });
  }

  // ---------- turnaround sheets ----------

  setupSheet() {
    this.sheet = null;
    $('sheet-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        this.openSheet(await loadImage(file), file.name);
      } catch (err) {
        this.toast(err.message);
      }
    });
    $('sheet-sample').addEventListener('click', () => this.openSheet(sampleSheet(drawFigureView), 'sample sheet'));
    $('sheet-cancel').addEventListener('click', () => this.closeSheet());
    $('sheet-apply').addEventListener('click', () => this.applySheet());
    $('sheet-ai').addEventListener('click', () => this.labelSheetWithClaude());
    try {
      const saved = localStorage.getItem(AI_KEY);
      if (saved) {
        $('ai-key').value = saved;
        $('ai-remember').checked = true;
      }
    } catch { /* storage unavailable */ }
    $('ai-remember').addEventListener('change', () => this.storeKey());
    $('ai-key').addEventListener('change', () => this.storeKey());
  }

  storeKey() {
    try {
      if ($('ai-remember').checked && $('ai-key').value.trim()) localStorage.setItem(AI_KEY, $('ai-key').value.trim());
      else localStorage.removeItem(AI_KEY);
    } catch { /* storage unavailable */ }
  }

  openSheet(img, name) {
    const figures = splitSheet(img, this.settings());
    if (!figures.length) {
      this.toast(`No figures found in ${name}. Try a higher ink threshold, or turn on Invert for light drawings on dark paper.`);
      return;
    }
    this.sheet = { img, name, figures };
    this.renderSheet();
    $('sheet-review').hidden = false;
    $('sheet-review').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  closeSheet() {
    this.sheet = null;
    $('sheet-review').hidden = true;
    $('sheet-figures').innerHTML = '';
  }

  renderSheet(message) {
    const { figures, name } = this.sheet;
    const used = figures.filter((f) => f.view !== 'skip').length;
    $('sheet-summary').textContent = message
      || `Found ${figures.length} figure${figures.length > 1 ? 's' : ''} in ${name}. ${used} will be used. Check each label, then use them.`;
    const box = $('sheet-figures');
    box.innerHTML = '';
    for (const f of figures) {
      const card = document.createElement('div');
      card.className = 'sheet-fig';
      card.classList.toggle('is-skip', f.view === 'skip');
      const thumb = document.createElement('canvas');
      thumb.width = 120;
      thumb.height = 160;
      const ctx = thumb.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 120, 160);
      const k = Math.min(112 / f.crop.width, 152 / f.crop.height);
      ctx.drawImage(f.crop, (120 - f.crop.width * k) / 2, (160 - f.crop.height * k) / 2, f.crop.width * k, f.crop.height * k);
      const id = `sheet-view-${f.index}`;
      card.innerHTML = `<span class="fig-num">#${f.index}</span><label class="visually-hidden" for="${id}">View for figure ${f.index}</label>
        <select id="${id}">${VIEW_CHOICES.map((v) => `<option value="${v}">${LABELS[v]}</option>`).join('')}</select>
        <span class="fig-reason"></span>`;
      card.insertBefore(thumb, card.children[1]);
      const select = card.querySelector('select');
      select.value = f.view;
      card.querySelector('.fig-reason').textContent = f.reason;
      select.addEventListener('change', () => {
        f.view = select.value;
        f.reason = 'Set by you.';
        this.renderSheet();
      });
      box.appendChild(card);
    }
  }

  applySheet() {
    const chosen = this.sheet.figures.filter((f) => f.view !== 'skip');
    if (!chosen.length) {
      this.toast('Pick a view for at least one figure.');
      return;
    }
    const seen = new Set();
    for (const f of chosen) {
      if (seen.has(f.view)) {
        this.toast(`More than one figure is set to ${LABELS[f.view]}. Each view can be used once.`);
        return;
      }
      seen.add(f.view);
    }
    this.sources = {};
    this.masks = {};
    for (const f of chosen) this.sources[f.view] = { img: f.crop, name: `${this.sheet.name} #${f.index}` };
    $('mv-derive').checked = true;
    this.closeSheet();
    this.reprocess();
    this.redrawAll();
    this.toast(`Using ${chosen.length} views. Enter the character's real height under Real size.`);
    $('mv-height').focus();
  }

  async labelSheetWithClaude() {
    const key = $('ai-key').value.trim();
    if (!key) {
      $('ai-settings').open = true;
      $('ai-key').focus();
      this.toast('Add your Anthropic API key to label with Claude.');
      return;
    }
    const button = $('sheet-ai');
    button.disabled = true;
    button.textContent = 'Asking Claude…';
    try {
      const { labelWithClaude } = await import('./ai-label.js');
      const sheet = numberedSheet(this.sheet.img, this.sheet.figures);
      const labels = await labelWithClaude(key, sheet, this.sheet.figures.length);
      let changed = 0;
      for (const l of labels) {
        const f = this.sheet.figures.find((x) => x.index === l.index);
        if (!f) continue;
        if (f.view !== l.view) changed++;
        f.view = l.view;
        f.reason = `Claude: ${l.note}`;
      }
      this.renderSheet(`Claude labelled ${labels.length} figure${labels.length > 1 ? 's' : ''} and changed ${changed}. Check them, then use them.`);
    } catch (err) {
      this.toast(err.message || 'Claude labelling failed.');
    } finally {
      button.disabled = false;
      button.textContent = 'Label with Claude';
    }
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
