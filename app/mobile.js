// 폰(PWA) 틀: 아래 탭으로 타이머 / 기록 / 통계 / 관리를 오간다.
// 타이머는 맥 패널과 같은 코드(panel.js), 나머지는 맥 통계 창과 같은 코드(win.js).
import './panel.js';
import './win.js';
import { invoke, listen } from './store.js';

const tabs = document.querySelectorAll('#tabbar [data-tab]');
function show(tab) {
  document.getElementById('tab-timer').hidden = tab !== 'timer';
  document.getElementById('tab-rest').hidden = tab === 'timer';
  tabs.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
  if (tab !== 'timer') dispatchEvent(new CustomEvent('tw-go', { detail: tab }));
  window.scrollTo(0, 0);
}
tabs.forEach((b) => { b.onclick = () => show(b.dataset.tab); });
addEventListener('tw-nav', (e) => show(e.detail)); // 타이머 화면의 통계/기록/관리 버튼
show('timer');

// 동기화 연결 전이면 타이머 화면 위에 안내
async function notice(st) {
  st ??= await invoke('sync_status').catch(() => null);
  document.getElementById('m-notice')?.remove();
  if (!st || st.connected) return;
  const el = document.createElement('div');
  el.id = 'm-notice';
  el.className = 'm-notice';
  el.innerHTML = '<span>맥과 동기화가 아직 연결되지 않았어요</span><button class="btn">연결하기</button>';
  el.querySelector('button').onclick = () => { show('manage'); setTimeout(() => document.getElementById('mg-sync')?.scrollIntoView({ block: 'start' }), 50); };
  document.getElementById('tab-timer').prepend(el);
}
notice();
listen('sync-status', notice);

// 오프라인에서도 열리게
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
