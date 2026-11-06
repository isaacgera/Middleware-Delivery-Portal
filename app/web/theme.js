/**
 * Theme control — manual light/dark toggle that persists, with an "auto" (follow-OS) mode.
 * Cycles: auto -> light -> dark -> auto. Stored in localStorage under 'mdp-theme'.
 * Respects prefers-color-scheme when in auto mode (handled in tokens.css).
 */

const KEY = 'mdp-theme';
const MODES = ['auto', 'light', 'dark'];
const ICONS = { auto: '🌓', light: '☀️', dark: '🌙' };
const LABELS = { auto: 'Theme: follows system', light: 'Theme: light', dark: 'Theme: dark' };

function getStored() {
  const v = localStorage.getItem(KEY);
  return MODES.includes(v) ? v : 'auto';
}

function apply(mode) {
  const root = document.documentElement;
  if (mode === 'auto') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', mode);
  }
}

function updateButton(btn, mode) {
  if (!btn) return;
  btn.textContent = ICONS[mode];
  btn.setAttribute('aria-label', LABELS[mode]);
  btn.setAttribute('title', LABELS[mode]);
}

export function initTheme() {
  const mode = getStored();
  apply(mode);

  const btn = document.getElementById('theme-toggle');
  updateButton(btn, mode);

  if (btn) {
    btn.addEventListener('click', () => {
      const current = getStored();
      const next = MODES[(MODES.indexOf(current) + 1) % MODES.length];
      localStorage.setItem(KEY, next);
      apply(next);
      updateButton(btn, next);
    });
  }
}
