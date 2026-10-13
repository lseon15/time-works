// 통계 페이지
import { aggregate, periodRange, shiftPeriod, layerRows, rankRows, dailyTotals, runningEntry, buildTree, effectiveColor, fmtHM, fmtPct } from '../core/engine.js';
import { fillClass } from './fills.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
let range = null;
let shown = null; // 표시할 레이어 id (Set). 이 기기에만 기억

const SHOWN_KEY = 'tw.statsLayers';
const SORT_KEY = 'tw.statsSort';
let sort = (() => { try { return localStorage.getItem(SORT_KEY) === 'time' ? 'time' : 'tree'; } catch { return 'tree'; } })();
function loadShown(tree) {
  const all = tree.layers.map((l) => l.id);
  try {
    const saved = JSON.parse(localStorage.getItem(SHOWN_KEY) || 'null');
    if (saved && Array.isArray(saved.shown) && Array.isArray(saved.known)) {
      const known = new Set(saved.known);
      // 저장한 뒤에 새로 생긴 레이어는 켜진 상태로 시작
      return new Set(all.filter((id) => saved.shown.includes(id) || !known.has(id)));
    }
  } catch { /* 무시하고 전부 켬 */ }
  return new Set(all);
}
function saveShown(tree) {
  const known = tree.layers.map((l) => l.id);
  try { localStorage.setItem(SHOWN_KEY, JSON.stringify({ shown: known.filter((id) => shown.has(id)), known })); } catch { /* 무시 */ }
}

const WD = ['일', '월', '화', '수', '목', '금', '토'];
function rangeLabel(r) {
  const a = new Date(r.start);
  if (r.kind === 'day') return `${a.getFullYear()}년 ${a.getMonth() + 1}월 ${a.getDate()}일 ${WD[a.getDay()]}요일`;
  if (r.kind === 'month') return `${a.getFullYear()}년 ${a.getMonth() + 1}월`;
  const b = new Date(r.end);
  b.setDate(b.getDate() - 1); // 마지막 작업일 (하루 시작이 4시여도 날짜가 하루 밀리지 않게)
  return `${a.getMonth() + 1}월 ${a.getDate()}일 – ${b.getMonth() + 1}월 ${b.getDate()}일`;
}
const PERIOD = { day: '오늘', week: '이번 주', month: '이번 달' };

export function initStats(app) {
  // 주간·월간: 날짜별 막대 (최상위 분류로 쌓음)
  function daysChart(state, tree, tops, now) {
    const days = dailyTotals(state, range, now);
    const max = Math.max(1, ...days.map((d) => d.total));
    const month = range.kind === 'month';
    const todayKey = periodRange('day', now, state.settings).key;
    const cols = days.map((d) => {
      const dt = new Date(d.dayStart);
      const segs = tops.map((t) => ({ t, ms: d.byTop.get(t.id) || 0 })).filter((x) => x.ms > 0);
      const title = `${dt.getMonth() + 1}월 ${dt.getDate()}일 ${WD[dt.getDay()]} ${fmtHM(d.total)}`;
      const pct = (d.total / max) * 100;
      return `<div class="dcol" title="${esc(title)}">
        ${month || !d.total ? '' : `<div class="dval" style="bottom:${pct}%">${fmtHM(d.total)}</div>`}
        <div class="dbar" style="height:${pct}%">${segs.map((x) => `<span class="${fillClass(x.t.fill)}" style="flex:${x.ms}"></span>`).join('')}</div>
      </div>`;
    }).join('');
    const labs = days.map((d) => {
      const dt = new Date(d.dayStart);
      const cls = `${d.key === todayKey ? 'today' : ''} ${dt.getDay() === 0 || dt.getDay() === 6 ? 'wkend' : ''}`;
      return `<div class="dlab ${cls}">${month ? dt.getDate() : `${WD[dt.getDay()]}<br>${dt.getDate()}`}</div>`;
    }).join('');
    return `<div class="days ${month ? 'month' : ''}">${cols}</div><div class="dlabs">${labs}</div>`;
  }

  // 분류 × 작업 유형 — '분류별' 표와 같은 줄(정렬·레이어 설정 그대로)
  function renderCross(state, res, rows) {
    const wts = state.workTypes
      .filter((w) => !w.deleted && (!w.archived || (res.byWorkType.get(w.id) || 0) > 0))
      .sort((a, b) => a.order - b.order);
    if (!rows.length) { $('cross').innerHTML = '<tbody><tr><td class="hint">표시할 레이어를 하나 이상 켜 주세요.</td></tr></tbody>'; return; }
    const cell = (ms) => (ms ? `<span class="t">${fmtHM(ms)}</span><span class="p">${fmtPct(ms, res.total)}</span>` : '');
    const head = `<thead><tr><th>분류</th>${wts.map((w) => `<th class="wt"><span class="sw ${fillClass(w.color)}"></span>${esc(w.name)}</th>`).join('')}<th class="num">합계</th><th>구성</th></tr></thead>`;
    const body = rows.map((r) => {
      if (r.section) return `<tr class="sec"><td colspan="${wts.length + 3}">${esc(r.layer.name)}</td></tr>`;
      const mix = r.total ? `<div class="mixbar">${wts.map((w) => ({ w, ms: r.wt?.get(w.id) || 0 })).filter((x) => x.ms > 0)
        .map((x) => `<span class="${fillClass(x.w.color)}" style="flex:${x.ms}" title="${esc(x.w.name)} ${fmtHM(x.ms)}"></span>`).join('')}</div>` : '';
      const cls = sort === 'time' ? (r.other ? 'other' : 'ranked') : `${r.depth === 0 && !r.other ? 'top' : ''} ${r.other ? 'other' : ''}`;
      return `<tr class="${cls} ${r.total === 0 ? 'zero' : ''}">
        ${nameCell(r)}
        ${wts.map((w) => `<td class="wt">${cell(r.wt?.get(w.id) || 0)}</td>`).join('')}
        <td class="sum">${r.total ? fmtHM(r.total) : ''}</td>
        <td class="mix">${mix}</td>
      </tr>`;
    }).join('');
    const totals = `<tr class="top"><td class="name">전체</td>${wts.map((w) => `<td class="wt">${cell(res.byWorkType.get(w.id) || 0)}</td>`).join('')}<td class="sum">${fmtHM(res.total)}</td><td></td></tr>`;
    $('cross').innerHTML = `${head}<tbody>${body}${totals}</tbody>`;
  }

  // 분류 이름 칸 (분류순: 들여쓰기 / 시간순: 순위 + 경로)
  function nameCell(r) {
    if (sort === 'time') {
      return `<td class="name">${r.other ? '' : `<span class="rk">${r.total ? r.rank : ''}</span><span class="sw ${fillClass(r.color)}"></span>`}${esc(r.name)}${r.path?.length > 1 ? `<span class="pth">${esc(r.path.slice(0, -1).join(' › '))}</span>` : ''}</td>`;
    }
    return `<td class="name" style="padding-left:${8 + r.depth * 20}px">${r.depth === 0 && !r.other ? `<span class="sw ${fillClass(r.color)}"></span>` : ''}${esc(r.name)}</td>`;
  }

  function render() {
    const state = app.state;
    // 설정(하루 시작·주 시작)이 바뀌었을 수 있으니 보고 있던 기간의 가운데로 다시 잡는다
    range = range ? periodRange(range.kind, (range.start + range.end) / 2, state.settings) : periodRange('week', Date.now(), state.settings);
    const now = Date.now();
    const res = aggregate(state, range, now);
    const tree = buildTree(state);
    const isCurrent = range.start <= now && now < range.end;

    document.querySelectorAll('#kind .btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === range.kind)));
    $('range').textContent = rangeLabel(range);
    $('now-btn').textContent = PERIOD[range.kind];
    $('now-btn').disabled = isCurrent;

    // 1컷: 합계 + 최상위 분류 비율
    const tops = tree.children.get('root').map((id) => ({ id, name: tree.byId.get(id).name, ms: res.rolled.get(id) || 0, fill: effectiveColor(tree, id) }));
    const running = runningEntry(state);
    $('sum').innerHTML = `
      ${running && isCurrent ? '<div class="meta live">기록 중</div>' : ''}
      <div><span class="display">${fmtHM(res.total)}</span><span class="unit">시간</span></div>
      ${res.total > 0 ? `
        <div class="stack">${tops.filter((t) => t.ms > 0).map((t) => `<span class="${fillClass(t.fill)}" style="flex:${t.ms}" title="${esc(t.name)} ${fmtHM(t.ms)}"></span>`).join('')}</div>
        <div class="legend">${tops.map((t) => `<span><span class="sw ${fillClass(t.fill)}"></span>${esc(t.name)} ${fmtHM(t.ms)} (${fmtPct(t.ms, res.total)})</span>`).join('')}</div>`
      : `<div class="empty">이 기간에는 기록이 없습니다. 메뉴 막대 아이콘을 눌러 타이머를 시작하세요.</div>`}
      ${range.kind === 'day' ? '' : daysChart(state, tree, tops, now)}`;

    // 2컷: 레이어 체크박스 + 분류 표 (비율은 기간 전체 대비)
    if (!shown) shown = loadShown(tree);
    $('layers').innerHTML = '<span class="cap">표시할 레이어</span>' + tree.layers.map((l) => `
      <label class="tog"><input type="checkbox" data-layer="${esc(l.id)}" ${shown.has(l.id) ? 'checked' : ''}>${esc(l.name)}</label>`).join('');
    document.querySelectorAll('#sort .btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sort === sort)));
    const rows = sort === 'time'
      ? rankRows(state, res, { visibleLayers: shown })
      : layerRows(state, res, { visibleLayers: shown });
    // 막대 길이: 분류순은 표 전체 최댓값, 시간순은 레이어 묶음마다의 최댓값 기준
    const maxOf = new Map();
    let group = 'all';
    for (const r of rows) {
      if (r.section) { group = r.id; continue; }
      r.group = group;
      maxOf.set(group, Math.max(maxOf.get(group) || 1, r.total));
    }
    const cells = (r) => `
        <td class="num">${r.direct ? fmtHM(r.direct) : ''}</td>
        <td class="num total">${r.total ? fmtHM(r.total) : ''}</td>
        <td class="pc">${r.total ? fmtPct(r.total, res.total) : ''}</td>
        <td class="meter">${r.total ? `<div class="m ${r.other ? 'other' : fillClass(r.color)}" style="width:${(r.total / maxOf.get(r.group)) * 100}%"></div>` : ''}</td>`;
    const OTHER_TIP = 'title="상위 분류에 직접 기록했거나, 표시하지 않은 레이어에만 있는 시간"';
    const body = rows.map((r) => {
      if (r.section) {
        const n = rows.filter((x) => x.rank && x.layer?.id === r.layer.id && x.total > 0).length;
        return `<tr class="sec"><td colspan="6">${esc(r.layer.name)}<span class="meta">기록 있는 분류 ${n}개</span></td></tr>`;
      }
      if (sort === 'time') {
        return `<tr class="${r.other ? 'other' : 'ranked'} ${r.total === 0 ? 'zero' : ''}" ${r.other ? OTHER_TIP : ''}>
          ${nameCell(r)}<td class="ly"></td>${cells(r)}</tr>`;
      }
      return `<tr class="${r.depth === 0 && !r.other ? 'top' : ''} ${r.total === 0 ? 'zero' : ''} ${r.other ? 'other' : ''}" ${r.other ? OTHER_TIP : ''}>
        ${nameCell(r)}<td class="ly">${esc(r.layer?.name ?? '')}</td>${cells(r)}</tr>`;
    }).join('');
    $('tree').innerHTML = !rows.length
      ? '<tbody><tr><td class="hint">표시할 레이어를 하나 이상 켜 주세요.</td></tr></tbody>'
      : `<thead><tr><th>분류</th><th>${sort === 'time' ? '' : '레이어'}</th><th class="num">직접</th><th class="num">합계</th><th class="pc">비율</th><th></th></tr></thead><tbody>${body}</tbody>`;

    renderCross(state, res, rows);

    // 3컷: 작업 유형
    const types = state.workTypes.filter((w) => !w.deleted).sort((a, b) => a.order - b.order);
    const tmax = Math.max(1, ...types.map((w) => res.byWorkType.get(w.id) || 0));
    $('types').innerHTML = types.map((w) => {
      const ms = res.byWorkType.get(w.id) || 0;
      return `<div class="item">
        <div class="n"><span class="sw ${fillClass(w.color)}"></span>${esc(w.name)}</div>
        <div><span class="display">${fmtHM(ms)}</span><span class="pc">${fmtPct(ms, res.total)}</span></div>
        <div class="m ${fillClass(w.color)}" style="width:${ms ? Math.max(4, (ms / tmax) * 100) : 0}%;${ms ? '' : 'border:0'}"></div>
      </div>`;
    }).join('');
  }

  function go(r) { range = r; render(); }
  $('sort').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    sort = b.dataset.sort;
    try { localStorage.setItem(SORT_KEY, sort); } catch { /* 무시 */ }
    render();
  });
  $('layers').addEventListener('change', (e) => {
    const id = e.target.dataset.layer;
    if (!id) return;
    if (e.target.checked) shown.add(id); else shown.delete(id);
    saveShown(buildTree(app.state));
    render();
  });
  document.querySelectorAll('#kind .btn').forEach((b) => { b.onclick = () => go(periodRange(b.dataset.kind, Date.now(), app.state.settings)); });
  $('prev').onclick = () => go(shiftPeriod(range, -1, app.state.settings));
  $('next').onclick = () => go(shiftPeriod(range, 1, app.state.settings));
  $('now-btn').onclick = () => go(periodRange(range.kind, Date.now(), app.state.settings));

  return { render };
}
