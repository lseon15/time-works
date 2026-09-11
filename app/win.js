// 통계 창 — 통계·관리 두 페이지를 담는 틀. 상태를 들고 있고, 변경은 전부 change() 를 거친다.
import { loadState, saveState, onExternalChange, listen, ctx } from './store.js';
import { runningEntry } from '../core/engine.js';
import { initStats } from './page-stats.js';
import { initManage } from './page-manage.js';
import { initRecords } from './page-records.js';

const $ = (id) => document.getElementById(id);

const app = {
  state: null,
  page: 'stats',
  // 변경 → 즉시 저장. 실패하면 이유를 보여주고 파일 내용으로 되돌린다. 성공 여부를 돌려준다.
  async change(fn, { quiet = false } = {}) {
    app.error('');
    let ok = true;
    try {
      fn(app.state, ctx());
      await saveState(app.state);
    } catch (e) {
      ok = false;
      app.error(e?.message ?? String(e));
      app.state = await loadState();
    }
    if (!quiet || !ok) app.render();
    return ok;
  },
  error(msg) {
    const pg = pages[app.page];
    if (pg?.showError) { pg.showError(msg); $('err').textContent = ''; } else $('err').textContent = msg;
  },
  render() { pages[app.page].render(); },
};

const pages = {
  stats: initStats(app),
  records: initRecords(app),
  manage: initManage(app),
};

function go(page) {
  if (!pages[page]) page = 'stats';
  app.page = page;
  document.querySelectorAll('[data-page]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.page === page)));
  for (const k of Object.keys(pages)) $(`page-${k}`).hidden = k !== page;
  app.error('');
  app.render();
}
document.querySelectorAll('[data-page]').forEach((b) => { b.onclick = () => go(b.dataset.page); });
addEventListener('tw-go', (e) => go(e.detail)); // 폰의 아래 탭

async function boot() {
  try { app.state = await loadState(); } catch (e) { $('err').textContent = `데이터를 불러오지 못했습니다: ${e?.message ?? e}`; return; }
  go(window.__TW_PAGE);
  listen('go-page', (page) => go(page));
  // 패널에서 기록을 시작·정지하면 다시 불러온다. 관리 화면에서 입력 중이면 편집 칸은 건드리지 않는다.
  onExternalChange(async () => {
    app.state = await loadState();
    pages[app.page].render({ keepEditor: true });
  }, () => app.state);
  // 기록 중일 때 30초마다 숫자 갱신 (편집 중인 칸은 건드리지 않음)
  setInterval(() => { if (runningEntry(app.state) && !document.hidden && app.page !== 'manage') pages[app.page].render({ keepEditor: true }); }, 30000);
}
boot();
