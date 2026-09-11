// 메뉴 막대 패널 — 실제 타이머 (4단계)
// 원칙: 상태가 바뀔 때만 전체를 다시 그린다. 1초마다는 숫자 두 개만 바꾼다(입력 중인 메모가 날아가지 않게).
import { loadState, saveState, onExternalChange, invoke, ctx, fmtDay, fmtHMS, IS_DESKTOP } from './store.js';
import {
  aggregate, periodRange, runningEntry, buildTree, categoryPath, effectiveColor, isSelectable,
  layerInfo, recentCombos, lastWorkTypeFor, fmtHM,
} from '../core/engine.js';
import { startTimer, stopTimer, updateEntry } from '../core/rules.js';
import { fillClass } from './fills.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

let state = null;
let sel = { categoryId: null, workTypeId: null }; // 다음에 시작할 조합
let query = '';
let visibleIds = []; // 키보드 ↑↓ 이동 대상 (현재 목록의 분류 순서)

const liveWorkTypes = () => state.workTypes.filter((w) => !w.deleted && !w.archived).sort((a, b) => a.order - b.order);

/* ───────── 그리기 ───────── */

function renderAll() {
  renderNow();
  renderList();
  renderChips();
  renderStart();
  tick();
}

// 1초마다: 오늘 합계와 경과 시간 숫자만
function tick() {
  const now = Date.now();
  const day = periodRange('day', now, state.settings);
  $('today-label').textContent = `${fmtDay(day.start)} 합계`;
  $('today-total').textContent = fmtHM(aggregate(state, day, now).total);
  const r = runningEntry(state);
  const el = document.querySelector('#now .elapsed');
  if (r && el) el.textContent = fmtHMS(now - r.start);
}

function renderNow() {
  const r = runningEntry(state);
  const box = $('now');
  box.classList.toggle('on-air', !!r);
  box.classList.toggle('idle', !r);
  if (!r) {
    box.innerHTML = '<div class="hint">분류와 작업 유형을 골라 시작하세요.</div><div class="meta">대기 중</div>';
    return;
  }
  const tree = buildTree(state);
  const path = categoryPath(tree, r.categoryId);
  const wt = state.workTypes.find((w) => w.id === r.workTypeId);
  box.innerHTML = `
    <div class="meta">기록 중</div>
    <div class="path">${esc(path.slice(0, -1).join(' › '))}</div>
    <div class="top"><span class="name">${esc(path.at(-1) ?? '')}</span><span class="display elapsed"></span></div>
    <div class="bottom">
      <span class="wt"><span class="${fillClass(wt?.color)}"></span>${esc(wt?.name ?? '')}</span>
      <input class="field memo" id="memo" placeholder="메모" value="${esc(r.note ?? '')}" aria-label="메모">
      <button class="btn" id="stop">정지</button>
    </div>`;
  $('stop').onclick = () => change((s, c) => stopTimer(s, c));
  const memo = $('memo');
  const saveMemo = () => {
    const cur = runningEntry(state);
    if (cur && cur.id === r.id && memo.value !== (cur.note ?? '')) {
      change((s, c) => updateEntry(s, c, r.id, { note: memo.value }), { keepNow: true });
    }
  };
  // 입력을 멈추고 0.6초 뒤 저장 — 패널 밖을 눌러 창이 바로 닫혀도 메모가 남도록
  let t = null;
  memo.addEventListener('input', () => { clearTimeout(t); t = setTimeout(saveMemo, 600); });
  memo.addEventListener('blur', () => { clearTimeout(t); saveMemo(); });
  memo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); memo.blur(); } });
}

function itemHtml(id, tree, { recent = null, withPath = false } = {}) {
  const c = tree.byId.get(id);
  const depth = recent || withPath ? 0 : categoryPath(tree, id).length - 1;
  const selected = recent
    ? false
    : id === sel.categoryId;
  if (recent) {
    const wt = state.workTypes.find((w) => w.id === recent.workTypeId);
    return `<div class="item recent" data-recent="${esc(id)}|${esc(recent.workTypeId)}" title="클릭하면 바로 시작">
      <span class="sw ${fillClass(effectiveColor(tree, id))}"></span>
      <span class="nm">${esc(c.name)}</span>
      <span class="sub">${esc(wt?.name ?? '')}</span>
      <span class="go">바로 시작</span>
    </div>`;
  }
  const sub = withPath ? `<span class="sub">${esc(categoryPath(tree, id).slice(0, -1).join(' › '))}</span>` : '';
  return `<div class="item ${depth === 0 && !withPath ? 'top' : ''}" role="option" data-id="${esc(id)}" aria-selected="${selected}"
      style="padding-left:${6 + depth * 14}px">
      ${depth === 0 || withPath ? `<span class="sw ${fillClass(effectiveColor(tree, id))}"></span>` : ''}
      <span class="nm">${esc(c.name)}</span>${sub}
      <span class="ly">${esc(layerInfo(tree, id).name)}</span>
    </div>`;
}

function renderList({ scroll = false } = {}) {
  const tree = buildTree(state);
  const list = $('list');
  const q = query.trim().toLowerCase();
  let html = '';
  visibleIds = [];

  if (!q) {
    const running = runningEntry(state);
    const recent = recentCombos(state, 3, { exclude: running });
    if (recent.length) {
      html += '<div class="label">최근</div>' + recent.map((r) => itemHtml(r.categoryId, tree, { recent: r })).join('');
      html += '<div class="label">전체 분류</div>';
    }
    const walk = (id) => {
      if (!isSelectable(tree, id)) return;
      visibleIds.push(id);
      html += itemHtml(id, tree);
      for (const ch of tree.children.get(id) || []) walk(ch);
    };
    for (const id of tree.children.get('root')) walk(id);
  } else {
    for (const id of tree.byId.keys()) {
      if (!isSelectable(tree, id)) continue;
      const path = categoryPath(tree, id).join(' ').toLowerCase();
      if (tree.byId.get(id).name.toLowerCase().includes(q) || path.includes(q)) visibleIds.push(id);
    }
    // 이름이 검색어로 시작하는 것 먼저
    visibleIds.sort((a, b) => Number(!tree.byId.get(a).name.toLowerCase().startsWith(q)) - Number(!tree.byId.get(b).name.toLowerCase().startsWith(q)));
    html = visibleIds.length ? visibleIds.map((id) => itemHtml(id, tree, { withPath: true })).join('') : '<div class="none">맞는 분류가 없습니다. 새 분류는 아래 \'관리\'에서 추가하세요.</div>';
  }
  list.innerHTML = html;
  if (scroll) list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}

function renderChips() {
  $('chips').innerHTML = liveWorkTypes().map((w) => `
    <button class="chip" data-wt="${esc(w.id)}" aria-pressed="${w.id === sel.workTypeId}">
      <span class="${fillClass(w.color)}"></span>${esc(w.name)}
    </button>`).join('');
}

function renderStart() {
  const r = runningEntry(state);
  const same = r && r.categoryId === sel.categoryId && r.workTypeId === sel.workTypeId;
  const btn = $('start');
  btn.disabled = !sel.categoryId || !sel.workTypeId || same;
  btn.textContent = r ? (same ? '기록 중' : '바꿔서 시작') : '시작';
}

/* ───────── 동작 ───────── */

// 변경 → 즉시 저장 → 다시 그림. 실패하면 이유를 보여주고 파일 내용으로 되돌린다.
async function change(fn, { keepNow = false } = {}) {
  $('p-err').textContent = '';
  try {
    fn(state, ctx());
    await saveState(state);
  } catch (e) {
    $('p-err').textContent = e?.message ?? String(e);
    state = await loadState();
  }
  if (keepNow) { renderList(); renderStart(); tick(); } else renderAll();
}

function select(categoryId, { scroll = false } = {}) {
  sel.categoryId = categoryId;
  const last = lastWorkTypeFor(state, categoryId);
  const ok = new Set(liveWorkTypes().map((w) => w.id));
  if (last && ok.has(last)) sel.workTypeId = last;
  else if (!ok.has(sel.workTypeId)) sel.workTypeId = liveWorkTypes()[0]?.id ?? null;
  renderList({ scroll }); renderChips(); renderStart();
}

function start(combo = sel) {
  if (!combo.categoryId || !combo.workTypeId) return;
  const r = runningEntry(state);
  if (r && r.categoryId === combo.categoryId && r.workTypeId === combo.workTypeId) return;
  sel = { ...combo };
  query = '';
  $('search').value = '';
  change((s, c) => startTimer(s, c, combo));
}

$('list').addEventListener('click', (e) => {
  const rec = e.target.closest('[data-recent]');
  if (rec) { const [categoryId, workTypeId] = rec.dataset.recent.split('|'); start({ categoryId, workTypeId }); return; }
  const item = e.target.closest('[data-id]');
  if (item) select(item.dataset.id);
});
$('chips').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-wt]');
  if (!chip) return;
  sel.workTypeId = chip.dataset.wt;
  renderChips(); renderStart();
});
$('start').onclick = () => start();
$('open-stats').onclick = () => invoke('open_stats', { page: 'stats' }).catch((e) => { $('p-err').textContent = String(e); });
$('open-records').onclick = () => invoke('open_stats', { page: 'records' }).catch((e) => { $('p-err').textContent = String(e); });
$('open-manage').onclick = () => invoke('open_stats', { page: 'manage' }).catch((e) => { $('p-err').textContent = String(e); });

const search = $('search');
search.addEventListener('input', () => {
  query = search.value;
  renderList();
  if (query.trim() && visibleIds.length && !visibleIds.includes(sel.categoryId)) select(visibleIds[0]);
});

// ↑↓ 로 분류 이동, Enter 로 시작, Esc 는 검색어 지우기 → 한 번 더 누르면 닫기
document.addEventListener('keydown', (e) => {
  if (!document.getElementById('now')?.offsetParent) return; // 타이머 화면이 안 보이면 무시 (폰의 다른 탭)
  if (e.target.id === 'memo') { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.key === 'Escape') {
    if (search.value) { search.value = ''; query = ''; renderList(); } else invoke('close_panel');
    e.preventDefault();
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!visibleIds.length) return;
    const i = visibleIds.indexOf(sel.categoryId);
    const next = e.key === 'ArrowDown' ? Math.min(visibleIds.length - 1, i + 1) : Math.max(0, i - 1);
    select(visibleIds[i < 0 ? 0 : next], { scroll: true });
    e.preventDefault();
  } else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
    start();
    e.preventDefault();
  }
});

/* ───────── 시작 ───────── */

async function boot() {
  try {
    state = await loadState();
  } catch (e) {
    $('p-err').textContent = `데이터를 불러오지 못했습니다: ${e?.message ?? e}`;
    return;
  }
  // 처음 선택: 기록 중이면 그 조합, 아니면 가장 최근 조합
  const r = runningEntry(state);
  const recent = recentCombos(state, 1)[0];
  const first = r ?? recent;
  if (first) sel = { categoryId: first.categoryId, workTypeId: first.workTypeId };
  else sel = { categoryId: null, workTypeId: liveWorkTypes()[0]?.id ?? null };
  renderAll();
  if (IS_DESKTOP) search.focus(); // 폰에서는 자판이 바로 올라오지 않게
  onExternalChange(async () => { state = await loadState(); renderAll(); }, () => state);
  setInterval(tick, 1000);
}
boot();
