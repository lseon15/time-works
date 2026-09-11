// 기록 페이지 — 하루 단위로 기록을 보고 고친다(6단계).
// 편집은 '저장'을 눌러야 반영된다(시작·종료를 고치는 도중에는 앞뒤가 잠깐 맞지 않을 수 있으므로).
// 저장하지 않은 변경이 있으면 다른 기록으로 넘어가지 않고 알려준다.
import {
  buildTree, categoryPath, effectiveColor, isSelectable, entriesIn, gapsIn, periodRange, shiftPeriod,
  findOverlaps, recentCombos, entrySpan, aggregate, fmtHM,
} from '../core/engine.js';
import { addManualEntry, updateEntry, deleteEntry, splitEntry } from '../core/rules.js';
import { fillClass } from './fills.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const alive = (r) => r && !r.deleted;
const p2 = (n) => String(n).padStart(2, '0');
const dstr = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const tstr = (ts) => { const d = new Date(ts); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const md = (ts) => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()}`; };
const parseLocal = (d, t) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '') || !/^\d{2}:\d{2}/.test(t || '')) return NaN;
  const [y, m, dd] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  return new Date(y, m - 1, dd, hh, mm).getTime();
};
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const DAY_MS = 24 * 3600000;
const round5 = (ts) => Math.round(ts / 300000) * 300000;
const narrow = () => matchMedia('(max-width: 760px)').matches; // 폰: 편집 칸이 목록 아래에 있음
const toEditor = () => { if (narrow()) document.getElementById('rc-edit')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

export function initRecords(app) {
  let day = null;      // 보고 있는 작업일 (periodRange 'day')
  let form = null;     // 편집 칸 내용 { mode: 'edit'|'new', id, categoryId, workTypeId, sd, st, ed, et, note, running }
  let orig = null;     // 편집 시작 때의 내용 (바뀌었는지 비교용)
  let errMsg = '';
  let warnMsg = '';
  let armTimer = null;

  const S = () => app.state;
  const liveWts = () => S().workTypes.filter((w) => alive(w)).sort((a, b) => a.order - b.order);
  const entryById = (id) => S().entries.find((e) => e.id === id && alive(e)) ?? null;
  const dirty = () => !!form && (form.mode === 'new' || JSON.stringify(form) !== JSON.stringify(orig));
  // 하루 시작 시각이 바뀌었을 수 있으니 보던 날의 가운데로 다시 잡는다
  const ensureDay = () => { day = periodRange('day', day ? (day.start + day.end) / 2 : Date.now(), S().settings); };

  const formFrom = (e) => ({
    mode: 'edit', id: e.id, categoryId: e.categoryId, workTypeId: e.workTypeId,
    sd: dstr(e.start), st: tstr(e.start),
    ed: e.end === null ? '' : dstr(e.end), et: e.end === null ? '' : tstr(e.end),
    note: e.note ?? '', running: e.end === null,
  });

  /* ───────── 하루 머리 + 24시간 띠 ───────── */

  function renderDay() {
    const now = Date.now();
    const tree = buildTree(S());
    const list = entriesIn(S(), day, now);
    const total = aggregate(S(), day, now).total;
    const d = new Date(day.start);
    $('rc-date').value = dstr(day.start);
    $('rc-today').disabled = day.start <= now && now < day.end;

    // 겹치는 기록은 줄을 나눠 쌓는다
    const lanes = [];
    const blocks = list.map((e) => {
      const [a0, b0] = entrySpan(e, now);
      const a = Math.max(a0, day.start);
      const b = Math.min(b0, day.end);
      let lane = lanes.findIndex((end) => end <= a);
      if (lane < 0) { lane = lanes.length; lanes.push(b); } else lanes[lane] = b;
      return { e, a, b, lane };
    });
    const h = Math.max(1, lanes.length) * 22 + 4;
    const len = day.end - day.start;
    const x = (t) => ((t - day.start) / len) * 100;
    const startHour = new Date(day.start).getHours();
    const ticks = [0, 3, 6, 9, 12, 15, 18, 21, 24].map((k) => `<span style="left:${(k / 24) * 100}%">${(startHour + k) % 24}시</span>`).join('');

    $('rc-day').innerHTML = `
      <div class="head2">
        <span class="display">${fmtHM(total)}</span>
        <span class="sub">${d.getMonth() + 1}월 ${d.getDate()}일 ${WD[d.getDay()]}요일</span>
        <span class="sub">기록 ${list.length}건</span>
      </div>
      <div class="tl" style="height:${h}px">
        ${blocks.map(({ e, a, b, lane }) => `<div class="blk ${fillClass(effectiveColor(tree, e.categoryId))}" data-id="${esc(e.id)}"
            aria-selected="${form?.mode === 'edit' && form.id === e.id}"
            title="${esc(tstr(a))}–${esc(tstr(b))} ${esc(tree.byId.get(e.categoryId)?.name ?? '')}"
            style="left:${x(a)}%;width:${Math.max(0.25, x(b) - x(a))}%;top:${2 + lane * 22}px"></div>`).join('')}
        ${now >= day.start && now < day.end ? `<div class="now" style="left:${x(now)}%"></div>` : ''}
      </div>
      <div class="tl-ticks">${ticks}</div>`;
  }

  /* ───────── 목록 ───────── */

  function renderList() {
    const now = Date.now();
    const tree = buildTree(S());
    const list = entriesIn(S(), day, now);
    const gaps = gapsIn(S(), day, now);
    const items = [...list.map((e) => ({ at: e.start, e })), ...gaps.map((g) => ({ at: g.start, g }))].sort((p, q) => p.at - q.at);
    if (!items.length) {
      $('rc-list').innerHTML = '<div class="rc-none">이날은 기록이 없습니다. 위의 \'기록 추가\'로 직접 넣을 수 있어요.</div>';
      return;
    }
    $('rc-list').innerHTML = items.map(({ e, g }) => {
      if (g) {
        return `<div class="rc-gap" data-gap="${g.start}|${g.end}" title="이 빈 시간으로 기록 추가">
          <span>빈 시간 <b>${tstr(g.start)}–${tstr(g.end)}</b> (${fmtHM(g.end - g.start)})</span><span>여기에 기록 추가</span></div>`;
      }
      const c = tree.byId.get(e.categoryId);
      const path = categoryPath(tree, e.categoryId);
      const wt = S().workTypes.find((w) => w.id === e.workTypeId);
      const end = e.end ?? now;
      const crossA = e.start < day.start;
      const crossB = end > day.end;
      const ov = findOverlaps(S(), e, now).length;
      const badges = [
        e.end === null ? '<span class="badge live">진행 중</span>' : '',
        crossA ? '<span class="badge">전날부터</span>' : '',
        crossB ? '<span class="badge">다음 날까지</span>' : '',
        ov ? `<span class="badge warn">다른 기록과 겹침 ${ov}</span>` : '',
      ].join('');
      return `<div class="rc-row" role="option" tabindex="0" data-id="${esc(e.id)}" aria-selected="${form?.mode === 'edit' && form.id === e.id}">
        <div class="t">${tstr(e.start)}–${e.end === null ? '지금' : tstr(e.end)}${crossA || crossB ? `<small>${md(e.start)} → ${md(end)}</small>` : ''}</div>
        <div class="d">${fmtHM(end - e.start)}</div>
        <div class="who">
          <span class="sw ${fillClass(effectiveColor(tree, e.categoryId))}"></span><span class="nm">${esc(c?.name ?? '(찾을 수 없는 분류)')}</span><span class="path">${esc(path.slice(0, -1).join(' › '))}</span>
          ${e.note ? `<div class="memo">${esc(e.note)}</div>` : ''}
        </div>
        <div class="wt"><span class="sw ${fillClass(wt?.color)}"></span>${esc(wt?.name ?? '')}</div>
        <div class="badges">${badges}</div>
      </div>`;
    }).join('');
  }

  /* ───────── 편집 ───────── */

  function renderEditor() {
    const box = $('rc-edit');
    if (!form) {
      box.innerHTML = `<div class="kind">편집</div><div class="rc-empty">목록이나 위의 띠에서 기록을 고르세요. 타이머를 깜빡했다면 '기록 추가'나 빈 시간을 눌러 직접 넣을 수 있어요.</div><div class="rc-err" id="rc-err">${esc(errMsg)}</div>`;
      return;
    }
    const tree = buildTree(S());
    const isNew = form.mode === 'new';
    const e = isNew ? null : entryById(form.id);

    // 선택지는 전체 경로로 (닫힌 상태에서도 어느 가지의 분류인지 보이게)
    let catOpts = isNew && !form.categoryId ? '<option value="" selected>분류를 고르세요</option>' : '';
    const walk = (id) => {
      const ok = isSelectable(tree, id);
      if (ok || id === form.categoryId) {
        catOpts += `<option value="${esc(id)}" ${id === form.categoryId ? 'selected' : ''}>${esc(categoryPath(tree, id).join(' › '))}${ok ? '' : ' (보관)'}</option>`;
      }
      for (const ch of tree.children.get(id) || []) walk(ch);
    };
    for (const id of tree.children.get('root')) walk(id);

    const wts = liveWts().filter((w) => !w.archived || w.id === form.workTypeId);
    const path = form.categoryId && tree.byId.has(form.categoryId) ? categoryPath(tree, form.categoryId) : [];

    let splitHtml = '';
    if (e) {
      const mid = round5((e.start + (e.end ?? Date.now())) / 2);
      splitHtml = `
        <div class="rc-more">
          <div class="rc-f" style="margin-top:0"><span class="lb">쪼개기: 이 시각에서 둘로 나눈 뒤 뒤쪽 기록을 고칠 수 있어요</span>
            <div class="rc-split">
              <input type="date" class="field" id="rc-split-d" value="${dstr(mid)}" aria-label="쪼갤 날짜">
              <input type="time" class="field" id="rc-split-t" value="${tstr(mid)}" aria-label="쪼갤 시각">
              <button class="btn" data-act="split">쪼개기</button>
            </div></div>
          <div style="margin-top:12px"><button class="btn danger" data-act="delete">기록 삭제</button></div>
        </div>`;
    }

    box.innerHTML = `
      <div class="kind">${isNew ? '새 기록' : form.running ? '기록 (진행 중)' : '기록'}</div>
      <div class="big">${esc(path.at(-1) ?? '분류 미선택')}</div>
      <div class="path">${esc(path.slice(0, -1).join(' › '))}</div>
      <div class="rc-f"><label for="rc-cat">분류</label><select id="rc-cat">${catOpts}</select></div>
      <div class="rc-f"><span class="lb">작업 유형</span>
        <div class="rc-chips" id="rc-chips">${wts.map((w) => `<button class="chip" data-wt="${esc(w.id)}" aria-pressed="${w.id === form.workTypeId}"><span class="${fillClass(w.color)}"></span>${esc(w.name)}</button>`).join('')}</div></div>
      <div class="rc-f"><span class="lb">시작</span>
        <div class="rc-when"><input type="date" class="field" id="rc-sd" value="${esc(form.sd)}" aria-label="시작 날짜"><input type="time" class="field" id="rc-st" value="${esc(form.st)}" aria-label="시작 시각"></div></div>
      <div class="rc-f"><span class="lb">종료</span>
        ${form.running
          ? '<div class="rc-live">진행 중 — 멈추려면 메뉴 막대 패널에서 정지</div>'
          : `<div class="rc-when"><input type="date" class="field" id="rc-ed" value="${esc(form.ed)}" aria-label="종료 날짜"><input type="time" class="field" id="rc-et" value="${esc(form.et)}" aria-label="종료 시각"></div>`}</div>
      <div class="rc-f"><span class="lb">길이</span><div class="rc-len" id="rc-len"></div></div>
      <div class="rc-f"><label for="rc-note">메모</label><input class="field" id="rc-note" value="${esc(form.note)}" autocomplete="off"></div>
      <div class="rc-save">
        ${isNew
          ? '<button class="btn go" data-act="add">추가</button><button class="btn" data-act="cancel">취소</button>'
          : '<button class="btn go" data-act="save">저장</button><button class="btn" data-act="revert">되돌리기</button>'}
      </div>
      <div class="rc-warn" id="rc-warn">${esc(warnMsg)}</div>
      <div class="rc-err" id="rc-err">${esc(errMsg)}</div>
      ${splitHtml}`;
    refreshBits();
  }

  // 입력하는 동안에는 편집 칸을 다시 그리지 않고 길이·버튼만 갱신
  function refreshBits() {
    if (!form) return;
    const a = parseLocal(form.sd, form.st);
    const b = form.running ? Date.now() : parseLocal(form.ed, form.et);
    const len = $('rc-len');
    if (len) len.innerHTML = Number.isFinite(a) && Number.isFinite(b) && b > a
      ? `<span class="display">${fmtHM(b - a)}</span>${form.running ? '지금까지' : ''}`
      : '<span style="color:var(--signal)">종료가 시작보다 뒤여야 해요</span>';
    const d = dirty();
    document.querySelectorAll('#rc-edit [data-act="save"], #rc-edit [data-act="revert"]').forEach((btn) => { btn.disabled = !d; });
  }

  function readForm() {
    if (!form) return;
    const v = (id) => document.getElementById(id)?.value ?? '';
    form.categoryId = v('rc-cat') || form.categoryId;
    form.sd = v('rc-sd'); form.st = v('rc-st');
    if (!form.running) { form.ed = v('rc-ed'); form.et = v('rc-et'); }
    form.note = v('rc-note');
  }

  function showError(msg) { errMsg = msg; const el = document.getElementById('rc-err'); if (el) el.textContent = msg; }
  function showWarn(msg) { warnMsg = msg; const el = document.getElementById('rc-warn'); if (el) el.textContent = msg; }

  function render({ keepEditor = false } = {}) {
    ensureDay();
    // 고치던 기록이 다른 곳에서 바뀌었고 편집 중이 아니면 새 내용으로
    if (form?.mode === 'edit' && !dirty()) {
      const e = entryById(form.id);
      form = e ? formFrom(e) : null;
      orig = form ? { ...form } : null;
    }
    renderDay();
    renderList();
    const typing = document.activeElement && $('rc-edit').contains(document.activeElement);
    if (!(keepEditor && (dirty() || typing))) renderEditor();
    else refreshBits();
  }

  /* ───────── 고르기·새로 넣기 ───────── */

  const blockedByDirty = () => {
    if (!dirty()) return false;
    showWarn(form.mode === 'new' ? '새 기록을 추가하거나 취소한 뒤 다른 기록을 고르세요.' : '저장하지 않은 변경이 있어요. 저장하거나 되돌린 뒤 다른 기록을 고르세요.');
    return true;
  };

  function select(id) {
    if (form?.mode === 'edit' && form.id === id) return;
    if (blockedByDirty()) return;
    const e = entryById(id);
    if (!e) return;
    form = formFrom(e);
    orig = { ...form };
    errMsg = ''; warnMsg = '';
    renderDay(); renderList(); renderEditor();
    toEditor();
  }

  function startNew(start, end) {
    if (blockedByDirty()) return;
    const recent = recentCombos(S(), 1)[0];
    form = {
      mode: 'new', id: null,
      categoryId: recent?.categoryId ?? '', workTypeId: recent?.workTypeId ?? liveWts().find((w) => !w.archived)?.id ?? '',
      sd: dstr(start), st: tstr(start), ed: dstr(end), et: tstr(end), note: '', running: false,
    };
    orig = null;
    errMsg = ''; warnMsg = '';
    renderDay(); renderList(); renderEditor();
    if (narrow()) toEditor(); else $('rc-cat')?.focus();
  }

  // '기록 추가': 그날 마지막 기록 뒤 30분 (없으면 오전 9시부터 1시간). 미래로 넘어가지 않게.
  function defaultNewRange() {
    const now = Date.now();
    const list = entriesIn(S(), day, now);
    let start = list.length ? Math.max(...list.map((e) => e.end ?? now)) : day.start + 9 * 3600000;
    start = Math.min(round5(start), day.end - 1800000);
    let end = start + (list.length ? 1800000 : 3600000);
    if (end > now) { end = round5(now - 150000); start = Math.min(start, end - 1800000); }
    return [start, end];
  }

  $('rc-list').addEventListener('click', (ev) => {
    const gap = ev.target.closest('[data-gap]');
    if (gap) { const [a, b] = gap.dataset.gap.split('|').map(Number); startNew(a, b); return; }
    const row = ev.target.closest('[data-id]');
    if (row) select(row.dataset.id);
  });
  $('rc-list').addEventListener('keydown', (ev) => {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.dataset.id) { ev.preventDefault(); select(ev.target.dataset.id); }
  });
  $('rc-day').addEventListener('click', (ev) => { const b = ev.target.closest('.blk'); if (b) select(b.dataset.id); });

  const goDay = (r) => { day = r; errMsg = ''; renderDay(); renderList(); if (!dirty()) renderEditor(); };
  $('rc-prev').onclick = () => goDay(shiftPeriod(day, -1, S().settings));
  $('rc-next').onclick = () => goDay(shiftPeriod(day, 1, S().settings));
  $('rc-today').onclick = () => goDay(periodRange('day', Date.now(), S().settings));
  $('rc-date').addEventListener('change', (ev) => {
    const t = parseLocal(ev.target.value, '12:00');
    if (Number.isFinite(t)) goDay(periodRange('day', t, S().settings));
  });
  $('rc-add').onclick = () => { ensureDay(); const [a, b] = defaultNewRange(); startNew(a, b); };

  /* ───────── 편집 칸 동작 ───────── */

  const edit = $('rc-edit');
  edit.addEventListener('input', (ev) => {
    if (ev.target.id?.startsWith('rc-split')) return;
    readForm(); refreshBits();
  });
  edit.addEventListener('change', (ev) => {
    if (ev.target.id === 'rc-cat') { readForm(); renderEditor(); } // 제목·경로 갱신
  });
  edit.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target.tagName === 'INPUT' && !ev.target.id?.startsWith('rc-split')) {
      ev.preventDefault();
      edit.querySelector('[data-act="save"]:not(:disabled), [data-act="add"]')?.click();
    }
  });

  edit.addEventListener('click', async (ev) => {
    const chip = ev.target.closest('[data-wt]');
    if (chip && form) {
      readForm();
      form.workTypeId = chip.dataset.wt;
      edit.querySelectorAll('[data-wt]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.wt === form.workTypeId)));
      refreshBits();
      return;
    }
    const btn = ev.target.closest('[data-act]');
    if (!btn || !form) return;
    const act = btn.dataset.act;
    readForm();

    if (act === 'revert') { form = { ...orig }; warnMsg = ''; errMsg = ''; renderEditor(); return; }
    if (act === 'cancel') { form = null; orig = null; warnMsg = ''; errMsg = ''; render(); return; }

    if (act === 'save' || act === 'add') {
      const start = parseLocal(form.sd, form.st);
      const end = form.running ? null : parseLocal(form.ed, form.et);
      if (!form.categoryId) return showError('분류를 고르세요.');
      if (!Number.isFinite(start) || (end !== null && !Number.isFinite(end))) return showError('날짜와 시각을 모두 넣어 주세요.');
      let saved = null;
      let overlaps = [];
      const ok = await app.change((s, c) => {
        if (act === 'add') {
          ({ entry: saved, overlaps } = addManualEntry(s, c, { categoryId: form.categoryId, workTypeId: form.workTypeId, start, end, note: form.note }));
        } else {
          const e = entryById(form.id);
          const patch = {};
          if (form.categoryId !== e.categoryId) patch.categoryId = form.categoryId;
          if (form.workTypeId !== e.workTypeId) patch.workTypeId = form.workTypeId;
          if (form.note !== (e.note ?? '')) patch.note = form.note;
          if (form.sd !== orig.sd || form.st !== orig.st) patch.start = start; // 안 고친 시각은 초 단위까지 그대로
          if (!form.running && (form.ed !== orig.ed || form.et !== orig.et)) patch.end = end;
          ({ entry: saved, overlaps } = updateEntry(s, c, e.id, patch));
        }
      }, { quiet: true });
      if (!ok) return;
      form = formFrom(saved);
      orig = { ...form };
      errMsg = '';
      warnMsg = overlaps.length
        ? `저장했어요. 다른 기록 ${overlaps.length}개와 시간이 겹쳐요: ${overlaps.slice(0, 3).map((o) => `${tstr(o.start)}–${o.end === null ? '지금' : tstr(o.end)}`).join(', ')}`
        : '';
      day = periodRange('day', saved.start, S().settings); // 날짜를 옮겼으면 그날로 따라간다
      renderDay(); renderList(); renderEditor();
      return;
    }

    if (act === 'split') {
      if (dirty()) return showWarn('먼저 저장하거나 되돌린 뒤 쪼개 주세요.');
      const at = parseLocal($('rc-split-d').value, $('rc-split-t').value);
      let tail = null;
      const ok = await app.change((s, c) => { [, tail] = splitEntry(s, c, form.id, at); }, { quiet: true });
      if (!ok) return;
      form = formFrom(tail);
      orig = { ...form };
      errMsg = '';
      warnMsg = '쪼갰어요. 지금 보이는 건 뒤쪽 기록이에요. 분류나 작업 유형을 바꾸고 저장하세요.';
      renderDay(); renderList(); renderEditor();
      return;
    }

    if (act === 'delete') {
      if (btn.dataset.armed !== 'true') {
        btn.dataset.armed = 'true';
        btn.textContent = '한 번 더 누르면 삭제';
        clearTimeout(armTimer);
        armTimer = setTimeout(() => { btn.dataset.armed = 'false'; btn.textContent = '기록 삭제'; }, 4000);
        return;
      }
      clearTimeout(armTimer);
      const id = form.id;
      const ok = await app.change((s, c) => deleteEntry(s, c, id), { quiet: true });
      if (!ok) return;
      form = null; orig = null; warnMsg = ''; errMsg = '';
      render();
    }
  });

  return { render, showError, hasUnsaved: dirty };
}
