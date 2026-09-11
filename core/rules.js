// Time Works — 상태 변경 규칙 (1단계에서 확정한 규칙을 코드로)
// 모든 변경 함수는 ctx = { now, device } 를 받는다. 수정한 레코드는 updatedAt·device 가 갱신된다.
// 화면·저장소·동기화는 전부 이 함수들을 통해서만 상태를 바꾼다.

import { makeLayer, makeCategory, makeWorkType, makeEntry, COLLECTIONS } from './schema.js';
import { buildTree, descendants, runningEntry, findOverlaps } from './engine.js';

const alive = (r) => r && !r.deleted;
const touch = (rec, ctx) => { rec.updatedAt = ctx.now; rec.device = ctx.device; return rec; };
const find = (list, id) => list.find((r) => r.id === id && alive(r));
const need = (rec, what) => { if (!rec) throw new Error(`${what}을(를) 찾을 수 없음`); return rec; };

/* ───────────── 분류 ───────────── */

/* ───────────── 레이어 ───────────── */

const liveLayers = (state) => state.layers.filter(alive).sort((a, b) => a.order - b.order);

// index 위치에 끼워 넣는다(생략하면 맨 뒤). 기존 레이어의 order 는 건드리지 않는다.
export function addLayer(state, ctx, { name, index }) {
  const ls = liveLayers(state);
  const at = index === undefined ? ls.length : Math.max(0, Math.min(index, ls.length));
  const prev = ls[at - 1]?.order;
  const next = ls[at]?.order;
  const order = prev === undefined ? (next === undefined ? 0 : next - 1)
    : next === undefined ? prev + 1 : (prev + next) / 2;
  const l = makeLayer(ctx, { name, order });
  state.layers.push(l);
  return l;
}

export function renameLayer(state, ctx, id, name) {
  const l = need(find(state.layers, id), '레이어');
  const n = String(name ?? '').trim();
  if (!n) throw new Error('레이어 이름이 비어 있음');
  l.name = n;
  return touch(l, ctx);
}

// 쓰고 있는 분류가 있으면 삭제 불가
export function deleteLayer(state, ctx, id) {
  const l = need(find(state.layers, id), '레이어');
  const tree = buildTree(state);
  const users = [...tree.layerOf.entries()].filter(([, lid]) => lid === id).map(([cid]) => tree.byId.get(cid).name);
  if (users.length) throw new Error(`이 레이어를 쓰는 분류가 있어 삭제할 수 없음: ${users.slice(0, 3).join(', ')}${users.length > 3 ? ' 외' : ''}`);
  l.deleted = true;
  return touch(l, ctx);
}

// 분류의 레이어를 바꾼다. 상위보다 깊고, 모든 하위보다 얕아야 한다.
export function setCategoryLayer(state, ctx, id, layerId) {
  const c = need(find(state.categories, id), '분류');
  const tree = buildTree(state);
  const want = tree.layerIndex.get(layerId);
  if (want === undefined) throw new Error('레이어를 찾을 수 없음');
  const p = tree.parent.get(id);
  if (p && want <= tree.layerIndex.get(tree.layerOf.get(p))) throw new Error('상위 분류보다 깊은 레이어여야 함');
  for (const ch of tree.children.get(id) || []) {
    if (want >= tree.layerIndex.get(tree.layerOf.get(ch))) throw new Error('하위 분류보다 얕은 레이어여야 함');
  }
  c.layerId = layerId;
  return touch(c, ctx);
}

/* ───────────── 분류 ───────────── */

// 새 분류는 상위 바로 다음 레이어로. 상위가 마지막 레이어면 레이어부터 추가해야 한다.
export function addCategory(state, ctx, { name, parentId = null, color = null, layerId }) {
  if (parentId) need(find(state.categories, parentId), '상위 분류');
  const tree = buildTree(state);
  const pIdx = parentId ? tree.layerIndex.get(tree.layerOf.get(parentId)) : -1;
  let lid = layerId;
  if (lid === undefined) {
    if (tree.layers.length && pIdx + 1 >= tree.layers.length) {
      throw new Error(`'${tree.layers.at(-1).name}' 아래에는 분류를 만들 수 없음 — 레이어를 먼저 추가`);
    }
    lid = tree.layers[pIdx + 1]?.id ?? null;
  } else if (!(tree.layerIndex.get(lid) > pIdx)) {
    throw new Error('상위 분류보다 깊은 레이어여야 함');
  }
  const siblings = state.categories.filter((c) => alive(c) && (c.parentId ?? null) === parentId);
  const order = siblings.reduce((m, c) => Math.max(m, c.order + 1), 0);
  const c = makeCategory(ctx, { name, parentId, layerId: lid, color, order });
  state.categories.push(c);
  return c;
}

// 이름·색상·보관 여부만 바꾼다 (상위 변경은 moveCategory, 순서는 reorderCategory, 레이어는 setCategoryLayer)
export function updateCategory(state, ctx, id, patch) {
  const c = need(find(state.categories, id), '분류');
  const next = applyPatch(c, patch, ['name', 'color', 'archived'], '분류');
  Object.assign(c, next);
  return touch(c, ctx);
}

// 같은 상위 안에서 한 칸 위(-1)/아래(+1)로
export function reorderCategory(state, ctx, id, dir) {
  const c = need(find(state.categories, id), '분류');
  const siblings = state.categories.filter((x) => alive(x) && (x.parentId ?? null) === (c.parentId ?? null));
  return swapOrder(siblings, c, dir, ctx);
}

// 검증을 먼저 하고 나서 바꾼다(실패하면 레코드가 그대로 남도록)
function applyPatch(rec, patch, keys, what) {
  const next = {};
  for (const k of keys) if (k in patch) next[k] = k === 'name' ? String(patch.name ?? '').trim() : patch[k];
  if ('name' in next && !next.name) throw new Error(`${what} 이름이 비어 있음`);
  return next;
}

function swapOrder(list, rec, dir, ctx) {
  const sorted = list.slice().sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ko'));
  // 순서 값이 겹쳐 있으면 먼저 0,1,2… 로 정리
  if (new Set(sorted.map((x) => x.order)).size !== sorted.length) {
    sorted.forEach((x, i) => { if (x.order !== i) { x.order = i; touch(x, ctx); } });
  }
  const i = sorted.indexOf(rec);
  const j = i + dir;
  if (j < 0 || j >= sorted.length) return false;
  const other = sorted[j];
  [rec.order, other.order] = [other.order, rec.order];
  touch(rec, ctx);
  touch(other, ctx);
  return true;
}

// 다른 상위 아래로 이동. 자기 자신이나 자기 하위 아래로는 못 옮김.
// 합산은 저장하지 않고 매번 계산하므로, 옮기면 과거 통계도 새 구조를 따라간다.
// 레이어 순서가 어긋나면(새 상위보다 얕거나 같으면) 필요한 만큼만 아래 레이어로 밀어낸다. 하위도 연쇄로.
export function moveCategory(state, ctx, id, newParentId) {
  const c = need(find(state.categories, id), '분류');
  const tree = buildTree(state);
  if (newParentId) {
    need(find(state.categories, newParentId), '새 상위 분류');
    if (descendants(tree, id).has(newParentId)) throw new Error('자기 자신이나 하위 분류 아래로는 옮길 수 없음');
  }
  // 먼저 밀어낼 계획을 세우고, 레이어가 모자라면 아무것도 바꾸지 않고 멈춘다
  const idxOf = (x) => tree.layerIndex.get(tree.layerOf.get(x));
  const plan = new Map();
  const visit = (x, parentIdx) => {
    const cur = idxOf(x);
    const next = cur > parentIdx ? cur : parentIdx + 1;
    if (tree.layers.length && next >= tree.layers.length) {
      throw new Error(`레이어가 모자라 옮길 수 없음 — '${tree.layers.at(-1).name}' 아래에 레이어를 먼저 추가`);
    }
    if (next !== cur) plan.set(x, tree.layers[next].id);
    for (const ch of tree.children.get(x) || []) visit(ch, next);
  };
  if (tree.layers.length) visit(id, newParentId ? idxOf(newParentId) : -1);

  const siblings = state.categories.filter((x) => alive(x) && (x.parentId ?? null) === (newParentId ?? null) && x.id !== id);
  c.parentId = newParentId ?? null;
  c.order = siblings.reduce((m, x) => Math.max(m, x.order + 1), 0);
  touch(c, ctx);
  for (const [cid, lid] of plan) { const x = find(state.categories, cid); x.layerId = lid; touch(x, ctx); }
  return c;
}

// 삭제는 하위 전체에 기록이 하나도 없을 때만. 기록이 있으면 보관(archived)을 써야 한다.
export function deleteCategory(state, ctx, id) {
  need(find(state.categories, id), '분류');
  const ids = descendants(buildTree(state), id);
  if (state.entries.some((e) => alive(e) && ids.has(e.categoryId))) {
    throw new Error('기록이 있는 분류는 삭제할 수 없음 — 보관을 사용');
  }
  for (const c of state.categories) if (ids.has(c.id) && alive(c)) { c.deleted = true; touch(c, ctx); }
  return [...ids];
}

/* ───────────── 작업 유형 ───────────── */

export function addWorkType(state, ctx, { name, color = null }) {
  const order = state.workTypes.filter(alive).reduce((m, w) => Math.max(m, w.order + 1), 0);
  const w = makeWorkType(ctx, { name, color, order });
  state.workTypes.push(w);
  return w;
}

export function updateWorkType(state, ctx, id, patch) {
  const w = need(find(state.workTypes, id), '작업 유형');
  Object.assign(w, applyPatch(w, patch, ['name', 'color', 'archived'], '작업 유형'));
  return touch(w, ctx);
}

export function reorderWorkType(state, ctx, id, dir) {
  const w = need(find(state.workTypes, id), '작업 유형');
  return swapOrder(state.workTypes.filter(alive), w, dir, ctx);
}

export function deleteWorkType(state, ctx, id) {
  const w = need(find(state.workTypes, id), '작업 유형');
  if (state.entries.some((e) => alive(e) && e.workTypeId === id)) {
    throw new Error('기록이 있는 작업 유형은 삭제할 수 없음 — 보관을 사용');
  }
  w.deleted = true;
  return touch(w, ctx);
}

/* ───────────── 타이머 ───────────── */

// 진행 중 기록을 at 시각에 닫는다. 길이가 0 이하가 되면(시계 오차 등) 삭제 표시.
function closeAt(e, at, ctx) {
  if (at > e.start) e.end = at; else e.deleted = true;
  touch(e, ctx);
}

// 새 타이머 시작. 어느 기기에서 돌던 것이든 진행 중 기록은 지금 시각에 자동 종료.
export function startTimer(state, ctx, { categoryId, workTypeId, note = '' }) {
  need(find(state.categories, categoryId), '분류');
  need(find(state.workTypes, workTypeId), '작업 유형');
  for (const e of state.entries) if (alive(e) && e.end === null) closeAt(e, ctx.now, ctx);
  const e = makeEntry(ctx, { categoryId, workTypeId, start: ctx.now, end: null, note });
  state.entries.push(e);
  return e;
}

export function stopTimer(state, ctx) {
  const e = runningEntry(state);
  if (!e) return null;
  for (const x of state.entries) if (alive(x) && x.end === null) closeAt(x, ctx.now, ctx);
  return e;
}

/* ───────────── 기록 편집 ───────────── */

// 수동 입력 (종료 시각 필수). 겹치는 기록이 있어도 저장하고, 겹친 목록을 돌려준다.
// 미래 시각은 기록할 수 없다 (기기 간 시계 차이를 감안해 1분 여유)
const FUTURE_SLACK = 60000;
function noFuture(start, end, now) {
  if (start > now + FUTURE_SLACK || (end !== null && end > now + FUTURE_SLACK)) throw new Error('지금보다 뒤의 시각은 기록할 수 없음');
}

export function addManualEntry(state, ctx, { categoryId, workTypeId, start, end, note = '' }) {
  need(find(state.categories, categoryId), '분류');
  need(find(state.workTypes, workTypeId), '작업 유형');
  if (end === null || end === undefined) throw new Error('수동 입력은 종료 시각이 필요함');
  noFuture(start, end, ctx.now);
  const e = makeEntry(ctx, { categoryId, workTypeId, start, end, note });
  state.entries.push(e);
  return { entry: e, overlaps: findOverlaps(state, e, ctx.now) };
}

export function updateEntry(state, ctx, id, patch) {
  const e = need(find(state.entries, id), '기록');
  const next = { ...e, ...patch };
  if (patch.categoryId) need(find(state.categories, patch.categoryId), '분류');
  if (patch.workTypeId) need(find(state.workTypes, patch.workTypeId), '작업 유형');
  if (!Number.isFinite(next.start)) throw new Error('시작 시각이 올바르지 않음');
  if (next.end !== null && !(next.end > next.start)) throw new Error('종료 시각은 시작 시각보다 뒤여야 함');
  if ('start' in patch || 'end' in patch) noFuture(next.start, next.end, ctx.now);
  if (next.end === null && e.end !== null) {
    const r = runningEntry(state);
    if (r && r.id !== id) throw new Error('이미 진행 중인 기록이 있음');
  }
  for (const k of ['categoryId', 'workTypeId', 'start', 'end', 'note']) if (k in patch) e[k] = patch[k];
  touch(e, ctx);
  return { entry: e, overlaps: findOverlaps(state, e, ctx.now) };
}

export function deleteEntry(state, ctx, id) {
  const e = need(find(state.entries, id), '기록');
  e.deleted = true;
  return touch(e, ctx);
}

// 기록 모두 지우기 (분류·작업 유형·레이어·설정은 그대로). 진행 중 기록도 함께. 지운 건수를 돌려준다.
export function clearAllEntries(state, ctx) {
  let n = 0;
  for (const e of state.entries) if (alive(e)) { e.deleted = true; touch(e, ctx); n += 1; }
  return n;
}

// 기록 하나를 at 시각에서 둘로 나눈다. 뒤쪽 조각은 같은 분류·유형으로 시작 (나중에 따로 수정)
export function splitEntry(state, ctx, id, at) {
  const e = need(find(state.entries, id), '기록');
  const endNow = e.end ?? ctx.now;
  if (!(at > e.start && at < endNow)) throw new Error('나눌 시각이 기록 구간 안에 있어야 함');
  const tail = makeEntry(ctx, {
    categoryId: e.categoryId, workTypeId: e.workTypeId, start: at, end: e.end, note: e.note,
  });
  e.end = at;
  touch(e, ctx);
  state.entries.push(tail);
  return [e, tail];
}

/* ───────────── 설정 ───────────── */

// 하루 시작 시각(0~23), 주 시작 요일(1 = 월, 0 = 일)
// 항목마다 바꾼 시각을 따로 남긴다(stamps) → 두 기기에서 서로 다른 항목을 바꿔도 둘 다 살아남음
export function updateSettings(state, ctx, patch) {
  const next = { ...state.settings, stamps: { ...(state.settings?.stamps || {}) } };
  if ('dayStartHour' in patch) {
    const h = Number(patch.dayStartHour);
    if (!Number.isInteger(h) || h < 0 || h > 23) throw new Error('하루 시작 시각은 0~23시 사이여야 함');
    next.dayStartHour = h;
    next.stamps.dayStartHour = ctx.now;
  }
  if ('weekStartsOn' in patch) {
    const w = Number(patch.weekStartsOn);
    if (w !== 0 && w !== 1) throw new Error('한 주의 시작은 월요일 또는 일요일만 가능');
    next.weekStartsOn = w;
    next.stamps.weekStartsOn = ctx.now;
  }
  state.settings = next;
  return next;
}

function mergeSettings(local = {}, remote = {}) {
  const out = { ...local, stamps: { ...(local.stamps || {}) } };
  let changed = 0;
  for (const [k, t] of Object.entries(remote.stamps || {})) {
    if (t > (out.stamps[k] ?? -1)) { out[k] = remote[k]; out.stamps[k] = t; changed += 1; }
  }
  return { settings: out, changed };
}

/* ───────────── 동기화 병합 ───────────── */

// 같은 레코드가 양쪽에 있으면 updatedAt 이 큰 쪽이 이긴다.
// 동시각이면: 삭제 표시가 이김 → 그다음 device 문자열 순 (어느 기기에서 병합해도 결과가 같게)
function newer(a, b) {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  if (a.deleted !== b.deleted) return a.deleted ? a : b;
  return String(a.device) >= String(b.device) ? a : b;
}

function mergeList(local, remote) {
  const map = new Map(local.map((r) => [r.id, r]));
  let changed = 0;
  for (const r of remote) {
    const l = map.get(r.id);
    const win = l ? newer(l, r) : r;
    if (win !== l) { map.set(r.id, { ...win }); changed += 1; }
  }
  return { list: [...map.values()], changed };
}

// 원격 상태를 로컬에 병합하고, 진행 중 기록이 둘 이상이면 정리한다.
export function mergeRemote(state, remote, ctx) {
  let changed = 0;
  for (const k of COLLECTIONS) {
    const { list, changed: n } = mergeList(state[k] || [], remote[k] || []);
    state[k] = list;
    changed += n;
  }
  // 설정은 항목마다 나중에 바꾼 쪽
  const ms = mergeSettings(state.settings, remote.settings);
  state.settings = ms.settings;
  changed += ms.changed;
  const fixed = normalizeRunning(state, ctx);
  return { changed, fixedRunning: fixed };
}

// 두 기기에서 오프라인으로 각각 타이머를 켰던 경우: 가장 늦게 시작한 것만 남기고
// 나머지는 그 시작 시각에 종료한다.
export function normalizeRunning(state, ctx) {
  const running = state.entries.filter((e) => alive(e) && e.end === null).sort((a, b) => a.start - b.start);
  if (running.length <= 1) return 0;
  const latest = running.at(-1);
  for (const e of running.slice(0, -1)) closeAt(e, latest.start, ctx);
  return running.length - 1;
}

// 기록이 참조하는 분류가 삭제된 경우 등 데이터 이상 점검 (화면 경고용)
export function checkIntegrity(state) {
  const tree = buildTree(state);
  const problems = [];
  for (const e of state.entries) {
    if (!alive(e)) continue;
    if (!tree.byId.has(e.categoryId)) problems.push({ type: 'orphan-category', entryId: e.id });
    if (!find(state.workTypes, e.workTypeId)) problems.push({ type: 'orphan-worktype', entryId: e.id });
  }
  for (const id of tree.brokenCycles) problems.push({ type: 'cycle', categoryId: id });
  // 두 기기에서 따로 고친 결과 레이어 순서가 어긋난 분류 (상위보다 얕거나 같음)
  for (const [id, p] of tree.parent) {
    if (p && tree.layerIndex.get(tree.layerOf.get(id)) <= tree.layerIndex.get(tree.layerOf.get(p))) {
      problems.push({ type: 'layer-order', categoryId: id });
    }
  }
  return problems;
}
