import './styles.css';
import { initSync } from './data/sync.js';
import { setupPWA } from './pwa.js';
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
// Drop photos nothing refers to any more (the sync engine does this too while signed in).
setTimeout(() => import('./data/media.js').then((m) => m.collectUnusedMedia()).catch(() => {}), 5000);
