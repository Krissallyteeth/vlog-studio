// Paths like "places#<id>.shots#<id>.desc" address fields inside a project.
// A "key#id" segment selects the array item with that id.

export function getAt(root, path) {
  let cur = root;
  for (const seg of path.split('.')) {
    const [key, id] = seg.split('#');
    cur = cur?.[key];
    if (id !== undefined) cur = Array.isArray(cur) ? cur.find((x) => x.id === id) : undefined;
    if (cur === undefined || cur === null) return undefined;
  }
  return cur;
}

export function setAt(root, path, value) {
  const segs = path.split('.');
  const last = segs.pop();
  const parent = segs.length ? getAt(root, segs.join('.')) : root;
  if (!parent || typeof parent !== 'object' || last.includes('#')) return false;
  parent[last] = value;
  return true;
}
