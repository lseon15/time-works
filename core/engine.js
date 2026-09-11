// Time Works — 계산 엔진 (읽기 전용. 상태를 바꾸지 않는다)
// 맥·안드로이드 공통. 화면은 이 함수들의 결과만 그린다.

import { DEFAULT_SETTINGS } from './schema.js';

const alive = (r) => r && !r.deleted;
const cfg = (state) => ({ ...DEFAULT_SETTINGS, ...(state?.settings || {}) });

/* ───────────── 분류 트리 ───────────── */

// 삭제되지 않은 분류로 트리를 만든다. 보관된 분류도 포함(통계에는 남아야 하므로).
// 두 기기에서 오프라인으로 서로를 상대 아래로 옮기면 순환이 생길 수 있다 →
// 순환 안에서 id 가 가장 작은 분류를 최상위로 끊어낸다(어느 기기에서 계산해도 같은 결과).
export function buildTree(state) {
  const byId = new Map();
  for (const c of state.categories) if (alive(c)) byId.set(c.id, c);
  const parent = new Map();
  for (const c of byId.values()) {
    // 상위가 없거나 삭제됐으면 최상위로 취급 (데이터가 꼬여도 기록이 사라지지 않게)
    parent.set(c.id, c.parentId && byId.has(c.parentId) ? c.parentId : null);
  }
  const brokenCycles = [];
  const done = new Set();
  for (const id of byId.keys()) {
    const path = [];
    const onPath = new Set();
    let cur = id;
    while (cur && !done.has(cur)) {
      if (onPath.has(cur)) {
        const loop = path.slice(path.indexOf(cur));
        const cut = loop.slice().sort()[0];
        parent.set(cut, null);
        brokenCycles.push(cut);
        break;
      }
      onPath.add(cur);
      path.push(cur);
      cur = parent.get(cur);
    }
    for (const x of path) done.add(x);
  }
  const children = new Map([['root', []]]);
  for (const id of byId.keys()) {
    const p = parent.get(id) ?? 'root';
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(id);
  }
  for (const list of children.values()) {
    list.sort((a, b) => byId.get(a).order - byId.get(b).order
      || byId.get(a).name.localeCompare(byId.get(b).name, 'ko'));
  }

  // 레이어: 분류마다 지정. 비었거나 삭제된 레이어면 '상위 다음 레이어'로 추정(마지막 레이어에서 멈춤)
  const layers = (state.layers || []).filter(alive).sort((a, b) => a.order - b.order);
  const layerIndex = new Map(layers.map((l, i) => [l.id, i]));
  const layerOf = new Map();
  const assign = (id, parentIdx) => {
    const own = layerIndex.get(byId.get(id).layerId);
    const idx = own ?? Math.min(parentIdx + 1, layers.length - 1);
    layerOf.set(id, layers[idx]?.id ?? null);
    for (const ch of children.get(id) || []) assign(ch, idx);
  };
  for (const id of children.get('root')) assign(id, -1);

  return { byId, parent, children, brokenCycles, layers, layerIndex, layerOf };
}

// 분류의 레이어 (id, 이름, 순번)
export function layerInfo(tree, id) {
  const lid = tree.layerOf.get(id) ?? null;
  const idx = tree.layerIndex.get(lid);
  return { id: lid, index: idx ?? -1, name: idx === undefined ? '' : tree.layers[idx].name };
}

const parentOf = (tree, id) => tree.parent.get(id) ?? null;

// 자기 자신부터 최상위까지 [id, 상위, ..., 최상위]. 순환이 있어도 멈춘다.
export function ancestors(tree, id) {
  const out = [];
  const seen = new Set();
  let cur = tree.byId.has(id) ? id : null;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    cur = parentOf(tree, cur);
  }
  return out;
}

// 자기 자신 포함 모든 하위 id
export function descendants(tree, id) {
  const out = new Set();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    if (out.has(cur) || !tree.byId.has(cur)) continue;
    out.add(cur);
    for (const ch of tree.children.get(cur) || []) stack.push(ch);
  }
  return out;
}

// 화면 표시용 경로: ['게임', '시나리오 게임', '자체제작', '시냅티드']
export function categoryPath(tree, id) {
  return ancestors(tree, id).reverse().map((x) => tree.byId.get(x).name);
}

// 색상이 비어 있으면 가장 가까운 상위의 색
export function effectiveColor(tree, id) {
  for (const x of ancestors(tree, id)) {
    const c = tree.byId.get(x).color;
    if (c) return c;
  }
  return null;
}

// 타이머 선택 목록에 보일지: 자신과 모든 상위가 보관 상태가 아니어야 함
export function isSelectable(tree, id) {
  const chain = ancestors(tree, id);
  return chain.length > 0 && chain.every((x) => !tree.byId.get(x).archived);
}

/* ───────────── 날짜·기간 ───────────── */

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ts 가 속한 '작업일'의 시작 시각 (dayStartHour 반영, 기기 현지 시간 기준)
export function workDayStart(ts, settings = DEFAULT_SETTINGS) {
  const h = settings.dayStartHour ?? 0;
  const d = new Date(ts);
  const back = d.getHours() < h ? 1 : 0;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, h).getTime();
}

const addDays = (dayStartMs, n, settings) => {
  const d = new Date(dayStartMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, settings.dayStartHour ?? 0).getTime();
};

// 작업일 키 'YYYY-MM-DD' — 새벽 4시 시작이면 03:59 는 전날 키
export function dayKey(ts, settings = DEFAULT_SETTINGS) {
  return ymd(new Date(workDayStart(ts, settings)));
}

// 기간: kind = 'day' | 'week' | 'month'. 반환 { kind, key, start, end } — end 는 포함하지 않음
export function periodRange(kind, anchorTs, settings = DEFAULT_SETTINGS) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const h = s.dayStartHour;
  const ds = workDayStart(anchorTs, s);
  const d = new Date(ds);
  if (kind === 'day') {
    return { kind, key: ymd(d), start: ds, end: addDays(ds, 1, s) };
  }
  if (kind === 'week') {
    const diff = (d.getDay() - s.weekStartsOn + 7) % 7;
    const start = addDays(ds, -diff, s);
    return { kind, key: ymd(new Date(start)), start, end: addDays(start, 7, s) };
  }
  if (kind === 'month') {
    const start = new Date(d.getFullYear(), d.getMonth(), 1, h).getTime();
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1, h).getTime();
    return { kind, key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, start, end };
  }
  throw new Error(`알 수 없는 기간 종류: ${kind}`);
}

// 이전/다음 기간으로 이동 (n = -1 이전, +1 다음)
export function shiftPeriod(range, n, settings = DEFAULT_SETTINGS) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const d = new Date(range.start);
  if (range.kind === 'day') return periodRange('day', addDays(range.start, n, s), s);
  if (range.kind === 'week') return periodRange('week', addDays(range.start, 7 * n, s), s);
  const m = new Date(d.getFullYear(), d.getMonth() + n, 1, s.dayStartHour).getTime();
  return periodRange('month', m, s);
}

/* ───────────── 기록 → 시간 ───────────── */

// 기록의 실제 구간. 진행 중이면 now 까지.
export function entrySpan(e, now) {
  const end = e.end ?? now;
  return [e.start, Math.max(e.start, end)];
}

const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

// 기록 하나를 작업일 단위로 쪼갠 조각들: [{ key, dayStart, ms }]
export function splitByDay(e, now, settings = DEFAULT_SETTINGS) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const [a, b] = entrySpan(e, now);
  const out = [];
  if (b <= a) return out;
  let ds = workDayStart(a, s);
  while (ds < b) {
    const next = addDays(ds, 1, s);
    const ms = overlap(a, b, ds, next);
    if (ms > 0) out.push({ key: ymd(new Date(ds)), dayStart: ds, ms });
    ds = next;
  }
  return out;
}

/* ───────────── 집계 ───────────── */

/*
 * aggregate(state, range, now, opts)
 *   range: { start, end } (periodRange 결과 그대로 넣으면 됨)
 *   opts.rootId     이 분류(하위 포함) 기록만
 *   opts.workTypeId 이 작업 유형 기록만
 * 반환
 *   total       전체 시간(ms)
 *   direct      Map 분류id → 그 분류에 '직접' 기록된 시간
 *   rolled      Map 분류id → 직접 + 모든 하위 합산
 *   byWorkType  Map 작업유형id → 시간
 *   cross       Map 분류id → Map 작업유형id → 시간 (합산 기준)
 *   orphan      분류를 찾을 수 없는 기록의 시간 (정상이라면 0)
 *   count       구간에 걸친 기록 수
 */
export function aggregate(state, range, now, opts = {}) {
  const tree = buildTree(state);
  const scope = opts.rootId ? descendants(tree, opts.rootId) : null;
  const res = {
    total: 0, direct: new Map(), rolled: new Map(),
    byWorkType: new Map(), cross: new Map(), orphan: 0, count: 0,
  };
  const add = (map, k, v) => map.set(k, (map.get(k) || 0) + v);

  for (const e of state.entries) {
    if (!alive(e)) continue;
    if (opts.workTypeId && e.workTypeId !== opts.workTypeId) continue;
    const known = tree.byId.has(e.categoryId);
    if (scope && !scope.has(e.categoryId)) continue;
    const [a, b] = entrySpan(e, now);
    const ms = overlap(a, b, range.start, range.end);
    if (ms <= 0) continue;

    res.count += 1;
    res.total += ms;
    add(res.byWorkType, e.workTypeId, ms);
    if (!known) { res.orphan += ms; continue; }

    add(res.direct, e.categoryId, ms);
    for (const id of ancestors(tree, e.categoryId)) {
      add(res.rolled, id, ms);
      if (!res.cross.has(id)) res.cross.set(id, new Map());
      add(res.cross.get(id), e.workTypeId, ms);
    }
  }
  return res;
}

// 기간 안의 날짜별 합계 (차트용): [{ key, dayStart, total, byTop: Map 최상위분류id → ms }]
export function dailyTotals(state, range, now, opts = {}) {
  const s = cfg(state);
  const tree = buildTree(state);
  const scope = opts.rootId ? descendants(tree, opts.rootId) : null;
  const days = [];
  const index = new Map();
  for (let ds = range.start; ds < range.end; ds = addDays(ds, 1, s)) {
    const row = { key: ymd(new Date(ds)), dayStart: ds, total: 0, byTop: new Map() };
    index.set(row.key, row);
    days.push(row);
  }
  for (const e of state.entries) {
    if (!alive(e)) continue;
    if (opts.workTypeId && e.workTypeId !== opts.workTypeId) continue;
    if (scope && !scope.has(e.categoryId)) continue;
    const top = ancestors(tree, e.categoryId).at(-1) ?? null;
    for (const piece of splitByDay(e, now, s)) {
      const row = index.get(piece.key);
      if (!row) continue;
      row.total += piece.ms;
      row.byTop.set(top, (row.byTop.get(top) || 0) + piece.ms);
    }
  }
  return days;
}

// 트리 표 한 줄씩 (트리 순서, 깊이 포함): [{ id, depth, name, path, color, archived, direct, total }]
export function treeRows(state, result, { includeZero = true } = {}) {
  const tree = buildTree(state);
  const rows = [];
  const walk = (id, depth) => {
    const total = result.rolled.get(id) || 0;
    if (includeZero || total > 0) {
      const c = tree.byId.get(id);
      rows.push({
        id, depth, name: c.name, path: categoryPath(tree, id),
        color: effectiveColor(tree, id), archived: c.archived,
        layer: layerInfo(tree, id),
        direct: result.direct.get(id) || 0, total,
      });
    }
    for (const ch of tree.children.get(id) || []) walk(ch, depth + 1);
  };
  for (const id of tree.children.get('root')) walk(id, 0);
  return rows;
}

/*
 * 레이어 체크박스로 거른 표 (통계 창)
 *   visibleLayers  보일 레이어 id 들 (Set). 체크 안 한 레이어의 분류는 줄이 사라지고,
 *                  그 아래 분류가 가장 가까운 '보이는 상위' 밑으로 올라온다.
 *   → '작품'만 켜면 깊이와 상관없이 모든 작품이 한 목록에 모인다.
 * 보이는 줄로 설명되지 않는 시간(상위에 직접 기록 / 숨긴 레이어에만 있는 시간)은
 * '그 외' 줄로 모은다 → 한 부모 아래 줄들의 합 = 부모, 최상위 줄들의 합 = 기간 전체.
 * 반환 줄: { id, depth, name, path, color, layer, direct, total, other? }
 */
// '그 외' 줄의 작업 유형별 시간 = 부모(없으면 기간 전체) − 보이는 하위 줄들
function restCross(result, parentId, coveredIds) {
  const base = parentId ? result.cross.get(parentId) : result.byWorkType;
  const out = new Map(base || []);
  for (const id of coveredIds) {
    for (const [wt, ms] of result.cross.get(id) || []) out.set(wt, (out.get(wt) || 0) - ms);
  }
  for (const [wt, ms] of out) if (ms <= 0) out.delete(wt);
  return out;
}

export function layerRows(state, result, { visibleLayers, includeZero = true, otherName = '그 외' } = {}) {
  const tree = buildTree(state);
  const show = (id) => !visibleLayers || visibleLayers.has(tree.layerOf.get(id));
  const rows = [];
  // 반환: 이 가지에서 '가장 가까운 보이는 분류'들의 id (부모의 '그 외' 계산용)
  const walk = (id, depth) => {
    const total = result.rolled.get(id) || 0;
    if (!show(id)) {
      const covered = [];
      for (const ch of tree.children.get(id) || []) covered.push(...walk(ch, depth));
      return covered;
    }
    if (!includeZero && total === 0) return [id];
    const c = tree.byId.get(id);
    rows.push({
      id, depth, name: c.name, path: categoryPath(tree, id),
      color: effectiveColor(tree, id), archived: c.archived, layer: layerInfo(tree, id),
      direct: result.direct.get(id) || 0, total, wt: new Map(result.cross.get(id) || []),
    });
    const mark = rows.length;
    const covered = [];
    for (const ch of tree.children.get(id) || []) covered.push(...walk(ch, depth + 1));
    const rest = total - covered.reduce((a, x) => a + (result.rolled.get(x) || 0), 0);
    if (rows.length > mark && rest > 0) {
      rows.push({ id: `other:${id}`, depth: depth + 1, name: otherName, path: [], color: null, layer: null, direct: 0, total: rest, other: true, wt: restCross(result, id, covered) });
    }
    return [id];
  };
  const covered = [];
  for (const id of tree.children.get('root')) covered.push(...walk(id, 0));
  const rest = result.total - covered.reduce((a, x) => a + (result.rolled.get(x) || 0), 0);
  if (rows.length > 0 && rest > 0) {
    rows.push({ id: 'other:root', depth: 0, name: otherName, path: [], color: null, layer: null, direct: 0, total: rest, other: true, wt: restCross(result, null, covered) });
  }
  return rows;
}

/*
 * 시간순 표 (통계 창 '시간순' 정렬)
 *   켜 둔 레이어마다 한 묶음. 묶음 안에서는 가지와 상관없이 시간이 긴 순서.
 *   같은 레이어의 분류끼리는 서로 겹치지 않으므로(하위는 항상 더 깊은 레이어) 묶음 합 + '그 외' = 기간 전체.
 * 반환: [{ section: true, layer }, { id, rank, name, path, color, layer, direct, total, wt }, …, { other: true, total, wt }, …]
 */
export function rankRows(state, result, { visibleLayers, includeZero = true, otherName = '그 외' } = {}) {
  const tree = buildTree(state);
  const treeOrder = new Map();
  const walk = (id) => { treeOrder.set(id, treeOrder.size); for (const ch of tree.children.get(id) || []) walk(ch); };
  for (const id of tree.children.get('root')) walk(id);

  const rows = [];
  for (const layer of tree.layers) {
    if (visibleLayers && !visibleLayers.has(layer.id)) continue;
    const all = [...treeOrder.keys()].filter((id) => tree.layerOf.get(id) === layer.id);
    const members = all
      .map((id) => ({ id, total: result.rolled.get(id) || 0 }))
      .filter((m) => includeZero || m.total > 0)
      .sort((a, b) => b.total - a.total || treeOrder.get(a.id) - treeOrder.get(b.id));
    rows.push({ section: true, id: `section:${layer.id}`, layer: { id: layer.id, name: layer.name } });
    let covered = 0;
    members.forEach((m, i) => {
      covered += m.total;
      const c = tree.byId.get(m.id);
      rows.push({
        id: m.id, depth: 0, rank: i + 1, name: c.name, path: categoryPath(tree, m.id),
        color: effectiveColor(tree, m.id), archived: c.archived, layer: layerInfo(tree, m.id),
        direct: result.direct.get(m.id) || 0, total: m.total, wt: new Map(result.cross.get(m.id) || []),
      });
    });
    const rest = result.total - covered;
    if (rest > 0) rows.push({ id: `other:${layer.id}`, depth: 0, name: otherName, path: [], color: null, layer: null, direct: 0, total: rest, other: true, wt: restCross(result, null, all) });
  }
  return rows;
}

// 비율 — 기준은 항상 기간 전체
export const pct = (ms, total) => (total > 0 ? (ms / total) * 100 : 0);
export function fmtPct(ms, total) {
  if (!(ms > 0) || !(total > 0)) return '0%';
  const p = pct(ms, total);
  if (p < 1) return '<1%';
  return `${Math.round(p)}%`;
}

/* ───────────── 기록 조회 ───────────── */

// 기간에 걸친 기록 (시작순). 진행 중 기록은 now 까지로 본다
export function entriesIn(state, range, now) {
  return state.entries
    .filter((e) => alive(e) && overlap(...entrySpan(e, now), range.start, range.end) > 0)
    .sort((a, b) => a.start - b.start || (a.end ?? now) - (b.end ?? now));
}

// 기록 사이의 빈 시간 (겹치는 기록은 합쳐서 본다). 첫 기록 시작 전·마지막 기록 끝 뒤는 제외.
// → [{ start, end }]  minMs 보다 짧은 틈은 버린다
export function gapsIn(state, range, now, minMs = 5 * 60000) {
  const spans = entriesIn(state, range, now)
    .map((e) => entrySpan(e, now))
    .map(([a, b]) => [Math.max(a, range.start), Math.min(b, range.end)])
    .sort((x, y) => x[0] - y[0]);
  const gaps = [];
  let curEnd = null;
  for (const [a, b] of spans) {
    if (curEnd !== null && a - curEnd >= minMs) gaps.push({ start: curEnd, end: a });
    curEnd = curEnd === null ? b : Math.max(curEnd, b);
  }
  return gaps;
}

// 그 분류에서 마지막으로 쓴 작업 유형 (없으면 null)
export function lastWorkTypeFor(state, categoryId) {
  let best = null;
  for (const e of state.entries) {
    if (alive(e) && e.categoryId === categoryId && (!best || e.start > best.start)) best = e;
  }
  return best?.workTypeId ?? null;
}

// 최근에 쓴 (분류, 작업 유형) 조합 — 최신순, 중복 제거. 삭제·보관된 분류/유형은 뺀다
export function recentCombos(state, limit = 3, { exclude = null } = {}) {
  const tree = buildTree(state);
  const wtOk = new Set(state.workTypes.filter((w) => alive(w) && !w.archived).map((w) => w.id));
  const seen = new Set();
  const out = [];
  const list = state.entries.filter(alive).sort((a, b) => b.start - a.start);
  for (const e of list) {
    const key = `${e.categoryId}|${e.workTypeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (exclude && key === `${exclude.categoryId}|${exclude.workTypeId}`) continue;
    if (!isSelectable(tree, e.categoryId) || !wtOk.has(e.workTypeId)) continue;
    out.push({ categoryId: e.categoryId, workTypeId: e.workTypeId, lastStart: e.start });
    if (out.length >= limit) break;
  }
  return out;
}


// 진행 중인 기록 (정상이라면 최대 하나)
export function runningEntry(state) {
  let best = null;
  for (const e of state.entries) {
    if (alive(e) && e.end === null && (!best || e.start > best.start)) best = e;
  }
  return best;
}

// 이 기록과 시간이 겹치는 다른 기록들 (저장은 허용, 화면에 경고용)
export function findOverlaps(state, entry, now) {
  const [a, b] = entrySpan(entry, now);
  return state.entries.filter((o) => alive(o) && o.id !== entry.id
    && overlap(a, b, ...entrySpan(o, now)) > 0);
}

/* ───────────── 표시 ───────────── */

// 3723000 → '1:02'  (시:분)
export function fmtHM(ms) {
  const m = Math.floor(ms / 60000);
  return `${Math.floor(m / 60)}:${pad(m % 60)}`;
}
