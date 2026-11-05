import en from './en.js';
import ko from './ko.js';
import zh from './zh.js';

/*
 * UI language. "system" follows the device (navigator.languages): Chinese → 中文, Korean → 한국어,
 * anything else → English. The choice is per device (localStorage); what people type is never translated.
 */

const DICTS = { ko, en, zh };
const PREF_KEY = 'vs-lang';
export const LANG_IDS = ['ko', 'en', 'zh'];
/** Options for the picker; each language is always named in itself. */
export const LANG_OPTIONS = [
  { id: 'system', label: null },
  { id: 'ko', label: '한국어' },
  { id: 'en', label: 'English' },
  { id: 'zh', label: '中文' },
];

export function detectLang(languages = globalThis.navigator?.languages ?? [globalThis.navigator?.language]) {
  for (const l of languages ?? []) {
    const code = String(l ?? '').toLowerCase();
    if (code.startsWith('zh')) return 'zh';
    if (code.startsWith('ko')) return 'ko';
    if (code.startsWith('en')) return 'en';
  }
  return 'en';
}

function readPref() {
  try {
    const v = globalThis.localStorage?.getItem(PREF_KEY);
    return v === 'ko' || v === 'en' || v === 'zh' ? v : 'system';
  } catch {
    return 'system';
  }
}

let pref = readPref();
let lang = pref === 'system' ? detectLang() : pref;

export const getLang = () => lang;
export const getLangPref = () => pref;

/** pref: "system" | "ko" | "en" | "zh". Callers re-render the screen afterwards. */
export function setLangPref(next) {
  pref = LANG_IDS.includes(next) ? next : 'system';
  try {
    if (pref === 'system') globalThis.localStorage?.removeItem(PREF_KEY);
    else globalThis.localStorage?.setItem(PREF_KEY, pref);
  } catch {
    /* private mode: the choice lasts for this visit only */
  }
  applyLang(pref === 'system' ? detectLang() : pref);
}

/** Forces a language without saving it (tests, previews). */
export function applyLang(next) {
  lang = LANG_IDS.includes(next) ? next : 'en';
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang;
    document.title = t('app.name');
  }
}

/**
 * Text for `key` in the current language, falling back to English then Korean.
 * `{name}` placeholders are filled from vars. Arrays (keyword lists) are returned as they are.
 */
export function t(key, vars) {
  const v = DICTS[lang][key] ?? DICTS.en[key] ?? DICTS.ko[key];
  if (v === undefined) return key;
  if (typeof v !== 'string' || !vars) return v;
  return v.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
}
