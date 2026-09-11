// 관리 페이지 — 분류·작업 유형·레이어를 고르고(왼쪽) 편집한다(오른쪽).
// 주의: 목록은 pointerdown 에서 고른다. 이름 입력칸이 blur 되며 저장·다시 그리기가 일어나도
//       고르기 동작이 사라지지 않게 하기 위함.
import {
  buildTree, categoryPath, descendants, effectiveColor, isSelectable, layerInfo, aggregate, fmtHM,
} from '../core/engine.js';
import {
  addCategory, updateCategory, moveCategory, deleteCategory, reorderCategory, setCategoryLayer,
  addWorkType, updateWorkType, deleteWorkType, reorderWorkType,
  addLayer, renameLayer, deleteLayer, updateSettings, clearAllEntries,
} from '../core/rules.js';
import { invoke, listen } from './store.js';
import { FILLS, fillClass } from './fills.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const alive = (r) => r && !r.deleted;
const ALL_TIME = { start: 0, end: 8.64e15 };

export function initManage(app) {
  let sel = null;          // { kind: 'cat' | 'wt' | 'layer', id }
  let pending = null;      // 저장 대기 중인 이름 { kind, id, value }
  let nameTimer = null;
  let errMsg = '';

  const S = () => app.state;
  const wts = () => S().workTypes.filter(alive).sort((a, b) => a.order - b.order);
  const recOf = (s = sel) => {
    if (!s) return null;
    const list = s.kind === 'cat' ? S().categories : s.kind === 'wt' ? S().workTypes : S().layers;
    return list.find((r) => r.id === s.id && alive(r)) ?? null;
  };

  /* ───────── 목록 ───────── */

  function renderLists() {
    const tree = buildTree(S());
    const isSel = (kind, id) => sel?.kind === kind && sel.id === id;

    let cats = '';
    const walk = (id, depth) => {
      const c = tree.byId.get(id);
      cats += `<div class="mg-row ${depth === 0 ? 'top' : ''} ${isSelectable(tree, id) ? '' : 'dim'}" role="option" tabindex="0"
          data-sel="cat:${esc(id)}" aria-selected="${isSel('cat', id)}" style="padding-left:${8 + depth * 16}px">
        <span class="sw ${fillClass(effectiveColor(tree, id))}"></span>
        <span class="nm">${esc(c.name)}</span>
        ${c.archived ? '<span class="badge">보관</span>' : ''}
        <span class="ly">${esc(layerInfo(tree, id).name)}</span>
      </div>`;
      for (const ch of tree.children.get(id) || []) walk(ch, depth + 1);
    };
    for (const id of tree.children.get('root')) walk(id, 0);
    $('mg-cats').innerHTML = cats || '<div class="mg-empty">분류가 없습니다.</div>';

    $('mg-wts').innerHTML = wts().map((w) => `
      <div class="mg-row ${w.archived ? 'dim' : ''}" role="option" tabindex="0" data-sel="wt:${esc(w.id)}" aria-selected="${isSel('wt', w.id)}">
        <span class="sw ${fillClass(w.color)}"></span>
        <span class="nm">${esc(w.name)}</span>
        ${w.archived ? '<span class="badge">보관</span>' : ''}
      </div>`).join('') || '<div class="mg-empty">작업 유형이 없습니다.</div>';

    const uses = new Map();
    for (const lid of tree.layerOf.values()) uses.set(lid, (uses.get(lid) || 0) + 1);
    $('mg-layers').innerHTML = tree.layers.map((l, i) => `
      <div class="mg-row" role="option" tabindex="0" data-sel="layer:${esc(l.id)}" aria-selected="${isSel('layer', l.id)}">
        <span class="no">${i + 1}</span>
        <span class="nm">${esc(l.name)}</span>
        <span class="ct">분류 ${uses.get(l.id) || 0}개</span>
      </div>`).join('') || '<div class="mg-empty">레이어가 없습니다.</div>';
  }

  /* ───────── 편집 ───────── */

  const palette = (current, { inherit = null } = {}) => `
    <div class="pal">
      ${inherit ? `<button class="inherit" data-act="fill" data-fill="" aria-pressed="${!current}">${inherit}</button>` : ''}
      ${FILLS.map((f) => `<button class="${fillClass(f.key)}" data-act="fill" data-fill="${f.key}" title="${esc(f.name)}" aria-label="${esc(f.name)}" aria-pressed="${current === f.key}"></button>`).join('')}
    </div>`;

  const deleteBtn = (label, disabledWhy) => disabledWhy
    ? `<button class="btn danger" disabled title="${esc(disabledWhy)}">${label}</button>`
    : `<button class="btn danger" data-act="delete">${label}</button>`;

  function renderEditor() {
    const box = $('mg-edit');
    const rec = recOf();
    if (!rec) {
      sel = null;
      box.innerHTML = `<div class="kind">편집</div><div class="mg-empty">왼쪽 목록에서 분류, 작업 유형, 레이어 중 하나를 고르세요.</div><div class="mg-err" id="mg-err">${esc(errMsg)}</div>`;
      return;
    }
    const tree = buildTree(S());
    const nameField = (label) => `
      <div class="mg-f"><label for="mg-name">${label}</label>
        <input class="field" id="mg-name" value="${esc(rec.name)}" autocomplete="off" spellcheck="false"></div>`;

    if (sel.kind === 'cat') {
      const id = rec.id;
      const path = categoryPath(tree, id);
      const parent = tree.parent.get(id) ?? null;
      const subtree = descendants(tree, id);
      const res = aggregate(S(), ALL_TIME, Date.now());
      const count = S().entries.filter((e) => alive(e) && subtree.has(e.categoryId)).length;
      const myIdx = layerInfo(tree, id).index;
      const pIdx = parent ? layerInfo(tree, parent).index : -1;
      const childIdx = (tree.children.get(id) || []).map((ch) => layerInfo(tree, ch).index);
      const maxIdx = childIdx.length ? Math.min(...childIdx) : Infinity;

      let parentOpts = `<option value="" ${parent ? '' : 'selected'}>(최상위)</option>`;
      const walk = (x, d) => {
        if (subtree.has(x)) return;
        const c = tree.byId.get(x);
        parentOpts += `<option value="${esc(x)}" ${x === parent ? 'selected' : ''}>${'\u00A0\u00A0\u00A0'.repeat(d)}${esc(c.name)}${c.archived ? ' (보관)' : ''}</option>`;
        for (const ch of tree.children.get(x) || []) walk(ch, d + 1);
      };
      for (const x of tree.children.get('root')) walk(x, 0);

      const layerOpts = tree.layers.map((l, i) => `<option value="${esc(l.id)}" ${i === myIdx ? 'selected' : ''} ${i <= pIdx || i >= maxIdx ? 'disabled' : ''}>${esc(l.name)}</option>`).join('');

      box.innerHTML = `
        <div class="kind">분류</div>
        <div class="path">${esc(path.slice(0, -1).join(' › ') || '최상위')}</div>
        <div class="big">${esc(rec.name)}</div>
        ${nameField('이름')}
        <div class="mg-f"><label for="mg-layer">레이어</label>
          <select id="mg-layer">${layerOpts}</select>
          <div class="note">상위 분류보다 깊고, 하위 분류보다 얕은 레이어만 고를 수 있어요.</div></div>
        <div class="mg-f"><label for="mg-parent">상위 분류</label>
          <select id="mg-parent">${parentOpts}</select>
          <div class="note">옮기면 과거 기록의 통계도 새 위치를 따라가요.</div></div>
        <div class="mg-f"><span class="lb">칠</span>${palette(rec.color, { inherit: parent ? '상위 따름' : '기본' })}</div>
        <div class="mg-f"><span class="lb">순서</span>
          <div class="mg-row2"><button class="btn" data-act="up">위로</button><button class="btn" data-act="down">아래로</button></div></div>
        <div class="mg-f"><span class="lb">누적 기록 (하위 포함)</span>
          <div class="mg-stat"><span class="display">${fmtHM(res.rolled.get(id) || 0)}</span>${count}건</div></div>
        <div class="mg-actions">
          <button class="btn" data-act="add-child">하위 분류 추가</button>
          <button class="btn" data-act="archive">${rec.archived ? '보관 해제' : '보관'}</button>
          ${deleteBtn(subtree.size > 1 ? `하위 ${subtree.size - 1}개 포함 삭제` : '삭제', count ? '기록이 있는 분류는 삭제 대신 보관만 할 수 있어요' : '')}
        </div>
        ${rec.archived ? '<div class="note" style="margin-top:8px">보관한 분류와 그 하위는 타이머 선택 목록에서 숨겨져요. 통계에는 그대로 남아요.</div>' : ''}
        <div class="mg-err" id="mg-err">${esc(errMsg)}</div>`;
    } else if (sel.kind === 'wt') {
      const res = aggregate(S(), ALL_TIME, Date.now());
      const count = S().entries.filter((e) => alive(e) && e.workTypeId === rec.id).length;
      box.innerHTML = `
        <div class="kind">작업 유형</div>
        <div class="big">${esc(rec.name)}</div>
        ${nameField('이름')}
        <div class="mg-f"><span class="lb">칠</span>${palette(rec.color)}</div>
        <div class="mg-f"><span class="lb">순서</span>
          <div class="mg-row2"><button class="btn" data-act="up">위로</button><button class="btn" data-act="down">아래로</button></div></div>
        <div class="mg-f"><span class="lb">누적 기록</span>
          <div class="mg-stat"><span class="display">${fmtHM(res.byWorkType.get(rec.id) || 0)}</span>${count}건</div></div>
        <div class="mg-actions">
          <button class="btn" data-act="archive">${rec.archived ? '보관 해제' : '보관'}</button>
          ${deleteBtn('삭제', count ? '기록이 있는 작업 유형은 삭제 대신 보관만 할 수 있어요' : '')}
        </div>
        ${rec.archived ? '<div class="note" style="margin-top:8px">보관한 작업 유형은 타이머에서 고를 수 없어요. 통계에는 그대로 남아요.</div>' : ''}
        <div class="mg-err" id="mg-err">${esc(errMsg)}</div>`;
    } else {
      const idx = tree.layerIndex.get(rec.id);
      const users = [...tree.layerOf.entries()].filter(([, lid]) => lid === rec.id).map(([cid]) => cid);
      box.innerHTML = `
        <div class="kind">레이어 ${idx + 1}단계</div>
        <div class="big">${esc(rec.name)}</div>
        ${nameField('이름')}
        <div class="mg-f"><span class="lb">이 레이어의 분류 (${users.length}개)</span>
          <div class="mg-users">${users.length ? users.map((cid) => `<span title="${esc(categoryPath(tree, cid).join(' › '))}">${esc(tree.byId.get(cid).name)}</span>`).join(', ') : '없음'}</div></div>
        <div class="mg-actions">
          <button class="btn" data-act="insert-before">이 앞에 레이어 끼워 넣기</button>
          ${deleteBtn('삭제', users.length ? '이 레이어를 쓰는 분류가 있으면 삭제할 수 없어요' : '')}
        </div>
        <div class="note" style="margin-top:8px">레이어 순서는 바꿀 수 없어요. 필요한 자리에 새 레이어를 끼워 넣으세요.</div>
        <div class="mg-err" id="mg-err">${esc(errMsg)}</div>`;
    }
  }

  function showError(msg) {
    errMsg = msg;
    const el = document.getElementById('mg-err');
    if (el) el.textContent = msg;
  }

  // 설정: 바꾸면 바로 저장. 자동 실행·데이터 폴더는 맥 앱에서만(실패하면 그 줄을 숨김)
  let auto = null; // { enabled, dev }
  let setMsg = '';
  let clearTimer = null;
  async function loadAuto() {
    try { auto = await invoke('autostart_get'); } catch { auto = null; }
    renderSettings();
  }

  function renderSettings() {
    if (!S()) return; // 아직 데이터를 불러오기 전
    const st = S().settings;
    const count = S().entries.filter(alive).length;
    const hours = Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === st.dayStartHour ? 'selected' : ''}>${h === 0 ? '0시 (자정)' : `${h}시`}</option>`).join('');
    $('mg-set').innerHTML = `
      <div class="row"><label class="lb" for="set-day">하루 시작 시각</label><select id="set-day">${hours}</select></div>
      <div class="note">새벽까지 작업하는 날이 많으면 4시처럼 두세요. 그 시각 전의 작업은 전날로 계산돼요.</div>
      <div class="row"><span class="lb">한 주의 시작</span>
        <div class="seg" role="group" aria-label="한 주의 시작">
          <button class="btn" data-week="1" aria-pressed="${st.weekStartsOn === 1}">월요일</button>
          <button class="btn" data-week="0" aria-pressed="${st.weekStartsOn === 0}">일요일</button>
        </div></div>
      ${auto ? `
      <div class="row"><span class="lb">로그인할 때 자동 실행</span>
        <div class="seg" role="group" aria-label="자동 실행">
          <button class="btn" data-auto="1" aria-pressed="${auto.enabled}" ${auto.dev ? 'disabled' : ''}>켬</button>
          <button class="btn" data-auto="0" aria-pressed="${!auto.enabled}" ${auto.dev ? 'disabled' : ''}>끔</button>
        </div></div>
      ${auto.dev ? '<div class="note">개발 모드에서는 바꿀 수 없어요. 응용 프로그램 폴더에 설치한 앱에서 켜 주세요.</div>' : ''}
      <div class="row"><span class="lb">데이터</span>
        <div class="mg-row2"><button class="btn" data-set="folder">데이터 폴더 열기</button>
        <button class="btn danger" data-set="clear" ${count ? '' : 'disabled'}>기록 ${count}건 모두 지우기</button></div></div>
      <div class="note">데이터 폴더에 기록 파일(state.json)과 최근 14일치 자동 백업(backups)이 있어요. '모두 지우기'는 기록만 지우고 분류·작업 유형·레이어·설정은 남겨요.</div>` : ''}
      <div class="mg-err">${esc(setMsg)}</div>`;
  }
  $('mg-set').addEventListener('change', (e) => {
    if (e.target.id === 'set-day') app.change((s, c) => updateSettings(s, c, { dayStartHour: Number(e.target.value) }));
  });
  $('mg-set').addEventListener('click', async (e) => {
    const w = e.target.closest('[data-week]');
    if (w) { app.change((s, c) => updateSettings(s, c, { weekStartsOn: Number(w.dataset.week) })); return; }
    const a = e.target.closest('[data-auto]');
    if (a) {
      setMsg = '';
      try { auto.enabled = await invoke('autostart_set', { enabled: a.dataset.auto === '1' }); } catch (err) { setMsg = String(err); }
      renderSettings();
      return;
    }
    const b = e.target.closest('[data-set]');
    if (!b) return;
    if (b.dataset.set === 'folder') { invoke('open_data_dir').catch((err) => { setMsg = String(err); renderSettings(); }); return; }
    if (b.dataset.set === 'clear') {
      if (b.dataset.armed !== 'true') { // 두 번 눌러야 실행
        b.dataset.armed = 'true';
        b.textContent = '한 번 더 누르면 모두 지워요';
        clearTimeout(clearTimer);
        clearTimer = setTimeout(() => renderSettings(), 4000);
        return;
      }
      clearTimeout(clearTimer);
      let n = 0;
      await app.change((s, c) => { n = clearAllEntries(s, c); });
      setMsg = `기록 ${n}건을 지웠어요. 어제까지의 상태는 데이터 폴더의 backups 에 남아 있어요.`;
      renderSettings();
    }
  });

  /* ───────── 동기화 (맥 앱에서만) ───────── */
  let sync = null;      // Rust 가 알려주는 상태 { connected, email, lastOk, lastError, busy }
  let syncMsg = '';
  let syncArm = null;
  async function loadSync() {
    try { sync = await invoke('sync_status'); } catch { sync = null; }
    renderSync();
  }
  listen('sync-status', (st) => { sync = st; renderSync(); }).catch(() => {});
  setInterval(() => { if (sync?.connected) renderSync(); }, 30000); // '몇 분 전' 갱신

  const ago = (ms) => {
    if (!ms) return '아직 없음';
    const m = Math.floor((Date.now() - ms) / 60000);
    if (m < 1) return '방금';
    if (m < 60) return `${m}분 전`;
    if (m < 24 * 60) return `${Math.floor(m / 60)}시간 전`;
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  function renderSync() {
    const box = $('mg-sync');
    if (!box) return;
    if (!sync) { box.closest('section').hidden = true; return; }
    box.closest('section').hidden = false;
    if (!sync.connected) {
      if (box.querySelector('.mg-sync-form') && box.contains(document.activeElement)) return; // 입력 중에는 그대로
      box.innerHTML = `
        <div class="mg-sync-form">
          <label>Supabase 주소 (Project URL)<input class="field" id="sy-url" placeholder="https://xxxx.supabase.co" autocomplete="off" spellcheck="false"></label>
          <label>공개 키 (Publishable key)<input class="field" id="sy-key" placeholder="sb_publishable_..." autocomplete="off" spellcheck="false"></label>
          <label>이메일<input class="field" id="sy-email" type="email" autocomplete="username" spellcheck="false"></label>
          <label>비밀번호<input class="field" id="sy-pw" type="password" autocomplete="current-password"></label>
          <button class="btn go" data-sy="connect">연결</button>
        </div>
        <div class="note">비밀번호는 저장하지 않아요. 로그인해서 받은 토큰만 이 맥의 데이터 폴더(sync.json)에 둬요.</div>
        <div class="mg-sync-err">${esc(syncMsg)}</div>`;
      return;
    }
    box.innerHTML = `
      <div class="mg-sync-on"><span class="who">${esc(sync.email)}</span>
        <span class="when ${sync.busy ? 'busy' : ''}">${sync.busy ? '동기화 중' : `마지막 동기화 ${ago(sync.lastOk)}`}</span></div>
      ${sync.lastError ? `<div class="mg-sync-err">${esc(sync.lastError)}</div>` : ''}
      <div class="mg-row2"><button class="btn" data-sy="now">지금 동기화</button><button class="btn danger" data-sy="off">연결 끊기</button></div>
      <div class="note">연결돼 있으면 1분마다, 그리고 기록을 바꿀 때마다 주고받아요. 연결을 끊어도 이 맥의 기록과 서버의 데이터는 지워지지 않아요.</div>
      <div class="mg-sync-err">${esc(syncMsg)}</div>`;
  }

  $('mg-sync').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'sy-pw') $('mg-sync').querySelector('[data-sy="connect"]')?.click(); });
  $('mg-sync').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-sy]');
    if (!b) return;
    const v = (id) => document.getElementById(id)?.value ?? '';
    if (b.dataset.sy === 'connect') {
      syncMsg = '';
      b.disabled = true; b.textContent = '연결하는 중…';
      try {
        sync = await invoke('sync_connect', { url: v('sy-url'), key: v('sy-key'), email: v('sy-email'), password: v('sy-pw') });
        syncMsg = '연결했어요. 곧 첫 동기화를 시작해요.';
      } catch (err) {
        syncMsg = String(err);
        b.disabled = false; b.textContent = '연결';
        const el = $('mg-sync').querySelector('.mg-sync-err'); if (el) el.textContent = syncMsg;
        return;
      }
      renderSync();
    } else if (b.dataset.sy === 'now') {
      syncMsg = '';
      invoke('sync_now');
    } else if (b.dataset.sy === 'off') {
      if (b.dataset.armed !== 'true') {
        b.dataset.armed = 'true'; b.textContent = '한 번 더 누르면 끊어요';
        clearTimeout(syncArm); syncArm = setTimeout(renderSync, 4000);
        return;
      }
      clearTimeout(syncArm);
      sync = await invoke('sync_disconnect');
      syncMsg = '연결을 끊었어요.';
      renderSync();
    }
  });

  function render({ keepEditor = false } = {}) {
    renderSync();
    renderSettings();
    renderLists();
    const typing = document.activeElement?.id === 'mg-name';
    if (!(keepEditor && typing)) renderEditor();
  }

  /* ───────── 이름 저장 (입력 멈추면 0.5초 뒤, 또는 칸을 벗어날 때) ───────── */

  async function flushName() {
    clearTimeout(nameTimer);
    const p = pending;
    pending = null;
    if (!p) return true;
    const rec = recOf(p);
    if (!rec || rec.name === p.value.trim()) return true;
    const ok = await app.change((s, c) => {
      if (p.kind === 'cat') updateCategory(s, c, p.id, { name: p.value });
      else if (p.kind === 'wt') updateWorkType(s, c, p.id, { name: p.value });
      else renameLayer(s, c, p.id, p.value);
    }, { quiet: true });
    if (ok) {
      renderLists();
      const big = document.querySelector('#mg-edit .big');
      if (big && sel?.id === p.id) big.textContent = p.value.trim();
    }
    return ok;
  }

  /* ───────── 고르기 ───────── */

  async function select(kind, id) {
    await flushName();
    sel = { kind, id };
    errMsg = '';
    renderLists();
    renderEditor();
    if (matchMedia('(max-width: 760px)').matches) $('mg-edit').scrollIntoView({ behavior: 'smooth', block: 'start' }); // 폰: 편집 칸이 아래에
  }

  const pickRow = (e) => {
    const row = e.target.closest('[data-sel]');
    if (!row) return;
    const [kind, id] = row.dataset.sel.split(/:(.*)/s);
    select(kind, id);
  };
  for (const id of ['mg-cats', 'mg-wts', 'mg-layers']) {
    $(id).addEventListener('pointerdown', pickRow);
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickRow(e); } });
  }

  // 새로 만든 항목을 고르고 이름 칸에 커서
  async function createAndEdit(kind, make) {
    await flushName();
    let made = null;
    const ok = await app.change((s, c) => { made = make(s, c); }, { quiet: true });
    if (!ok || !made) return;
    sel = { kind, id: made.id };
    errMsg = '';
    renderLists();
    renderEditor();
    const input = $('mg-name');
    input?.focus();
    input?.select();
  }

  $('add-top').onclick = () => createAndEdit('cat', (s, c) => addCategory(s, c, { name: '새 분류', color: 'paper' }));
  $('add-wt').onclick = () => createAndEdit('wt', (s, c) => addWorkType(s, c, { name: '새 작업 유형', color: 'paper' }));
  $('add-layer').onclick = () => createAndEdit('layer', (s, c) => addLayer(s, c, { name: '새 레이어' }));

  /* ───────── 편집 칸 동작 ───────── */

  const edit = $('mg-edit');

  edit.addEventListener('input', (e) => {
    if (e.target.id !== 'mg-name' || !sel) return;
    pending = { ...sel, value: e.target.value };
    clearTimeout(nameTimer);
    if (e.target.value.trim()) nameTimer = setTimeout(flushName, 500);
  });
  edit.addEventListener('keydown', (e) => {
    if (e.target.id !== 'mg-name') return;
    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    if (e.key === 'Escape') { pending = null; clearTimeout(nameTimer); e.target.value = recOf()?.name ?? ''; e.target.blur(); }
  });
  edit.addEventListener('focusout', (e) => {
    if (e.target.id !== 'mg-name') return;
    if (!e.target.value.trim()) { // 빈 이름은 저장하지 않고 되돌림
      pending = null; clearTimeout(nameTimer);
      e.target.value = recOf()?.name ?? '';
      showError('이름은 비워 둘 수 없어요.');
      return;
    }
    flushName();
  });

  edit.addEventListener('change', async (e) => {
    if (!sel || e.target.tagName !== 'SELECT') return; // 이름 칸의 change 는 focusout 에서 처리

    await flushName();
    const v = e.target.value;
    if (e.target.id === 'mg-parent') await app.change((s, c) => moveCategory(s, c, sel.id, v || null));
    if (e.target.id === 'mg-layer') await app.change((s, c) => setCategoryLayer(s, c, sel.id, v));
  });

  let armTimer = null;
  edit.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || !sel) return;
    const act = btn.dataset.act;
    const { kind, id } = sel;
    const rec = recOf();

    if (act === 'delete' && btn.dataset.armed !== 'true') { // 한 번 더 눌러야 삭제
      btn.dataset.armed = 'true';
      btn.dataset.label = btn.textContent;
      btn.textContent = '한 번 더 누르면 삭제';
      clearTimeout(armTimer);
      armTimer = setTimeout(() => { btn.dataset.armed = 'false'; btn.textContent = btn.dataset.label; }, 4000);
      return;
    }
    await flushName();

    if (act === 'fill') {
      const color = btn.dataset.fill || null;
      await app.change((s, c) => (kind === 'cat' ? updateCategory(s, c, id, { color }) : updateWorkType(s, c, id, { color })));
    } else if (act === 'up' || act === 'down') {
      const dir = act === 'up' ? -1 : 1;
      await app.change((s, c) => (kind === 'cat' ? reorderCategory(s, c, id, dir) : reorderWorkType(s, c, id, dir)));
    } else if (act === 'archive') {
      await app.change((s, c) => (kind === 'cat' ? updateCategory(s, c, id, { archived: !rec.archived }) : updateWorkType(s, c, id, { archived: !rec.archived })));
    } else if (act === 'add-child') {
      await createAndEdit('cat', (s, c) => addCategory(s, c, { name: '새 분류', parentId: id }));
    } else if (act === 'insert-before') {
      const idx = buildTree(S()).layerIndex.get(id);
      await createAndEdit('layer', (s, c) => addLayer(s, c, { name: '새 레이어', index: idx }));
    } else if (act === 'delete') {
      clearTimeout(armTimer);
      const ok = await app.change((s, c) => {
        if (kind === 'cat') deleteCategory(s, c, id);
        else if (kind === 'wt') deleteWorkType(s, c, id);
        else deleteLayer(s, c, id);
      }, { quiet: true });
      if (ok) { sel = null; render(); }
    }
  });

  loadAuto();
  loadSync();
  return { render, showError };
}
