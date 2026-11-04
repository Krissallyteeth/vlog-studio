const KEY = 'vs-theme';
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

export function getTheme() {
  try {
    return localStorage.getItem(KEY) || 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme = getTheme()) {
  const dark = theme === 'dark' || (theme === 'system' && media?.matches);
  document.documentElement.classList.toggle('dark', Boolean(dark));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#111113' : '#f6f6f4');
}

export function setTheme(theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode: theme still applies for this visit */
  }
  applyTheme(theme);
}

media?.addEventListener?.('change', () => applyTheme());
