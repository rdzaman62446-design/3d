import { carve } from './carve-core.js';

self.onmessage = (event) => {
  const { id, job } = event.data;
  try {
    const t0 = performance.now();
    const result = carve(job);
    result.ms = performance.now() - t0;
    self.postMessage({ id, ok: true, result }, [result.positions.buffer, result.indices.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message || String(err) });
  }
};
