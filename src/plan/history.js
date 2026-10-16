// Plan state with undo/redo. During a drag the editor calls `preview` on every
// move and `settle` once at the end, so a whole drag is a single undo step.
export class History {
  constructor(state) {
    this.state = state;
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this.state);
  }

  commit(next) {
    this.undoStack.push(this.state);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.state = next;
    this.emit();
  }

  preview(next) {
    this.state = next;
    this.emit();
  }

  settle(base) {
    if (base === this.state) return;
    this.undoStack.push(base);
    this.redoStack = [];
  }

  // Applies a change to a copy of the current state.
  update(fn) {
    const next = structuredClone(this.state);
    fn(next);
    this.commit(next);
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.state);
    this.state = this.undoStack.pop();
    this.emit();
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.state);
    this.state = this.redoStack.pop();
    this.emit();
    return true;
  }
}
