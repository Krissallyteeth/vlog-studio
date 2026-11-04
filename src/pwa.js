import { registerSW } from 'virtual:pwa-register';
import { flushAll } from './data/autosave.js';
import { toast } from './ui/dom.js';

// The service worker only caches app files. Project data lives in IndexedDB,
// which an app update never touches.
export function setupPWA() {
  if (!('serviceWorker' in navigator)) return;
  const updateSW = registerSW({
    onNeedRefresh() {
      if (document.getElementById('update-banner')) return;
      const bar = document.createElement('div');
      bar.id = 'update-banner';
      bar.className = 'update-banner';
      bar.innerHTML = `<span class="flex-1">새 버전이 있어요. 기록은 그대로 유지돼요.</span>
        <button type="button" class="btn btn-primary btn-sm">업데이트</button>`;
      bar.querySelector('button').addEventListener('click', async () => {
        await flushAll().catch(() => {});
        updateSW(true);
      });
      document.body.append(bar);
    },
    onOfflineReady() {
      toast('이제 오프라인에서도 사용할 수 있어요.');
    },
  });
}
