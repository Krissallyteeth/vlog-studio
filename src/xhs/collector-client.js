/*
 * Talks to the PC collector's waiting mode (tools/collector/xhs_server.py) on this computer only.
 * A web page cannot start programs, so when the collector is off the page opens a
 * vlogstudio-collector: link, which Windows hands to the collector once install.bat has
 * registered it. The collector answers only this app's address and only from 127.0.0.1.
 */

export const COLLECTOR_URL = 'http://127.0.0.1:47831';
export const LAUNCH_URL = 'vlogstudio-collector://start';
export const MAX_KEYWORDS = 5;
export const MAX_KEYWORD_LEN = 40;
export const DETAILS = 8;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One keyword per line (commas also split). Spaces inside a keyword are kept: "海南 新家" is one search. */
export function parseKeywords(text) {
  const keywords = [
    ...new Set(
      String(text ?? '')
        .split(/[\n,，、;；]+/)
        .map((s) => s.replace(/\s+/g, ' ').trim())
        .filter(Boolean),
    ),
  ];
  if (!keywords.length) return { keywords, error: 'none' };
  if (keywords.length > MAX_KEYWORDS) return { keywords, error: 'many' };
  if (keywords.some((k) => k.length > MAX_KEYWORD_LEN)) return { keywords, error: 'long' };
  return { keywords, error: null };
}

async function call(path, { method = 'GET', body, timeout = 4000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(COLLECTOR_URL + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      cache: 'no-store',
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  } finally {
    clearTimeout(timer);
  }
}

/** The collector's status, or null when it is not running (or not reachable). */
export async function collectorStatus() {
  try {
    const r = await call('/status', { timeout: 1500 });
    return r.status === 200 && r.data?.app === 'vlog-studio-collector' ? r.data : null;
  } catch {
    return null;
  }
}

/** Asks Windows to start the collector (the browser may ask first). */
export function launchCollector() {
  const a = document.createElement('a');
  a.href = LAUNCH_URL;
  a.click();
}

export async function waitForCollector(ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = await collectorStatus();
    if (s) return s;
    await sleep(1000);
  }
  return null;
}

/** { status: 202 started | 409 already running | 4xx refused, data } */
export async function startCollect(keywords, details = DETAILS) {
  return call('/search', { method: 'POST', body: { keywords, details } });
}

export async function getJob() {
  try {
    const r = await call('/job');
    return r.status === 200 ? r.data : null;
  } catch {
    return null;
  }
}

/** Polls the job until it ends; onUpdate gets every reading. Returns the finished job, or null if the collector went away. */
export async function followJob(onUpdate, { every = 2000, lostAfter = 6 } = {}) {
  let lost = 0;
  for (;;) {
    await sleep(every);
    const job = await getJob();
    if (!job || job.state === 'none') {
      if (++lost >= lostAfter) return null;
      continue;
    }
    lost = 0;
    onUpdate(job);
    if (job.state !== 'running') return job;
  }
}
