export function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let last = 0;
/** Strictly increasing ms timestamp, so two quick saves never share an updatedAt. */
export function now() {
  const t = Date.now();
  last = t > last ? t : last + 1;
  return last;
}
