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

applyTheme();

route(/^\/$/, (_, ctx) => renderHome(ctx));
route(/^\/new$/, (_, ctx) => renderProjectForm(null, ctx));
route(/^\/settings$/, (_, ctx) => renderSettings(ctx));
route(/^\/p\/([^/]+)\/info$/, ([id], ctx) => renderProjectForm(id, ctx));
route(/^\/p\/([^/]+)(?:\/([a-z]+))?(?:\/([^/]+))?$/, (params, ctx) => renderDetail(params, ctx));

window.addEventListener('offline', () => toast('오프라인이에요. 기록은 계속 이 기기에 저장돼요.'));
window.addEventListener('online', () => toast('다시 온라인이에요.'));
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  toast(`문제가 생겼어요: ${e.reason?.message ?? e.reason}`, { tone: 'error' });
});

// The sign-up confirmation link lands here with tokens in the hash (#access_token=…), which the hash
// router would read as a page path. Let the sync client consume it first, then start at home.
const authRedirect = /(^#|&)(access_token|error_description)=/.test(location.hash);
const syncReady = initSync().catch((err) => console.error('sync init failed', err));
if (authRedirect) {
  syncReady.finally(() => {
    if (/error_description=/.test(location.hash)) toast('이메일 인증에 실패했어요. 링크가 만료됐을 수 있어요.', { tone: 'error' });
    history.replaceState(null, '', location.pathname + location.search);
    startRouter();
  });
} else {
  startRouter();
}
setupPWA();
