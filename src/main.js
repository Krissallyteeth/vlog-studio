import './styles.css';
import { initSync } from './data/sync.js';
import { setupPWA } from './pwa.js';
import { watchTables } from './ui/stack-tables.js';
import { route, startRouter } from './router.js';
import { toast } from './ui/dom.js';
import { applyTheme } from './ui/theme.js';
import { renderDetail } from './views/detail.js';
import { renderHome } from './views/home.js';
import { renderProjectForm } from './views/projectForm.js';
import { renderSettings } from './views/settings.js';
import { applyLang, getLang, t } from './i18n/index.js';

applyTheme();
applyLang(getLang()); // sets <html lang> and the tab title

route(/^\/$/, (_, ctx) => renderHome(ctx));
route(/^\/new$/, (_, ctx) => renderProjectForm(null, ctx));
route(/^\/settings$/, (_, ctx) => renderSettings(ctx));
// 小红书 performance screens (loaded on demand so the planning app stays light).
route(/^\/data(?:\/([a-z]+))?(?:\/([^/]+))?$/, async (params, ctx) => (await import('./views/xhs/data.js')).renderData(params, ctx));
route(/^\/import$/, async (_, ctx) => (await import('./views/xhs/import.js')).renderImport(ctx));
route(/^\/xhs$/, async (_, ctx) => (await import('./views/xhs/dashboard.js')).renderDashboard(ctx));
route(/^\/xhs\/baseline$/, async (_, ctx) => (await import('./views/xhs/dashboard.js')).renderBaseline(ctx));
route(/^\/xhs\/backup$/, async (_, ctx) => (await import('./views/xhs/export.js')).renderBackup(ctx));
route(/^\/contents$/, async (_, ctx) => (await import('./views/xhs/post.js')).renderContents(ctx));
route(/^\/c\/([^/]+)$/, async (params, ctx) => (await import('./views/xhs/post.js')).renderPost(params, ctx));
route(/^\/ads$/, async (_, ctx) => (await import('./views/xhs/ads.js')).renderAds(ctx));
route(/^\/more$/, async (_, ctx) => (await import('./views/xhs/ads.js')).renderMore(ctx));
route(/^\/ocr-ad(?:\/([^/]+))?$/, async (params, ctx) => (await import('./views/xhs/ocr-ad.js')).renderOcrAd(params, ctx));
route(/^\/ocr(?:\/([^/]+))?(?:\/(d1|d2))?$/, async (params, ctx) => (await import('./views/xhs/ocr.js')).renderOcr(params, ctx));
route(/^\/p\/([^/]+)\/info$/, ([id], ctx) => renderProjectForm(id, ctx));
route(/^\/p\/([^/]+)(?:\/([a-z]+))?(?:\/([^/]+))?$/, (params, ctx) => renderDetail(params, ctx));

window.addEventListener('offline', () => toast(t('net.offline')));
window.addEventListener('online', () => toast(t('net.online')));
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  toast(t('error.generic', { msg: e.reason?.message ?? e.reason }), { tone: 'error' });
});

// The sign-up confirmation link lands here with tokens in the hash (#access_token=…), which the hash
// router would read as a page path. Let the sync client consume it first, then start at home.
const authRedirect = /(^#|&)(access_token|error_description)=/.test(location.hash);
const syncReady = initSync().catch((err) => console.error('sync init failed', err));
if (authRedirect) {
  syncReady.finally(() => {
    if (/error_description=/.test(location.hash)) toast(t('auth.confirmFailed'), { tone: 'error' });
    history.replaceState(null, '', location.pathname + location.search);
    startRouter();
  });
} else {
  startRouter();
}
setupPWA();
watchTables();
// Drop photos nothing refers to any more (the sync engine does this too while signed in).
setTimeout(() => import('./data/media.js').then((m) => m.collectUnusedMedia()).catch(() => {}), 5000);
