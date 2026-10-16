const KEY = 'draft3d-theme';

// Light/dark follows the system until the visitor picks one.
export function initTheme(button, onChange) {
  const root = document.documentElement;
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* storage unavailable */ }
  if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const current = () => root.dataset.theme || (media.matches ? 'dark' : 'light');
  const label = () => {
    if (!button) return;
    const next = current() === 'dark' ? 'light' : 'dark';
    button.setAttribute('aria-label', `Switch to ${next} theme`);
    button.title = `Switch to ${next} theme`;
  };
  label();
  button?.addEventListener('click', () => {
    root.dataset.theme = current() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, root.dataset.theme); } catch { /* storage unavailable */ }
    label();
    onChange?.();
  });
  media.addEventListener('change', () => { label(); onChange?.(); });
}
