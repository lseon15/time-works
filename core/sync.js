// Supabase 동기화 — 브라우저(안드로이드 PWA)용. 맥은 같은 일을 Rust(src-tauri/src/sync.rs)가 한다.
// 두 구현은 주고받는 모양(tw_pull / tw_push 의 줄)과 규칙이 같아야 한다.
//   줄 하나 = 레코드 하나 { kind, id, data, updated_at, deleted, device }
//   설정은 항목 하나 = 한 줄 { kind: 'settings', id: 항목, data: { value, updatedAt } }
//   known: "종류:id" → 서버에 있는 updatedAt. 이것과 다른 로컬 레코드만 보낸다.
import { COLLECTIONS } from './schema.js';
import { mergeRemote } from './rules.js';

const CHUNK = 500;
export const EPOCH = '1970-01-01T00:00:00Z';

export function normalizeUrl(u) {
  const url = String(u ?? '').trim().replace(/\/+$/, '');
  const local = url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost'); // 로컬 시험용
  if (!url.startsWith('https://') && !local) throw new Error('주소는 https:// 로 시작해야 해요. Supabase 의 Project URL 을 그대로 붙여 넣어 주세요.');
  return url;
}

function apiError(status, body) {
  const raw = body?.error_description || body?.msg || body?.message || body?.error || (typeof body === 'string' ? body.slice(0, 200) : '');
  const code = body?.code || body?.error_code || '';
  let hint = '동기화 중 오류가 났어요.';
  if (code === 'invalid_credentials' || /Invalid login credentials/.test(raw)) hint = '이메일이나 비밀번호가 맞지 않아요.';
  else if (code === 'PGRST202' || /Could not find the function/.test(raw)) hint = 'Supabase 에 설정 SQL(supabase/setup.sql)을 먼저 실행해 주세요.';
  else if (/refresh_token/.test(raw) || /refresh_token/.test(code)) hint = '로그인이 만료됐어요. 연결을 끊고 다시 연결해 주세요.';
  else if (status === 401 || /Invalid API key|No API key/.test(raw)) hint = '공개 키(publishable key)나 주소가 맞지 않아요.';
  else if (status === 403 || code === '42501') hint = '권한이 없어요. 설정 SQL 을 실행했는지 확인해 주세요.';
  return new Error(`${hint} [${status}] ${raw}`);
}

async function post(fetchFn, url, key, bearer, body) {
  let res;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`서버에 연결하지 못했어요. 인터넷 연결과 주소를 확인해 주세요. (${e?.message ?? e})`);
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (res.status >= 400) throw apiError(res.status, data);
  return data;
}

function applySession(cfg, v) {
  if (!v?.access_token || !v?.refresh_token) throw new Error('로그인 응답에 토큰이 없어요.');
  cfg.access_token = v.access_token;
  cfg.refresh_token = v.refresh_token;
  cfg.expires_at = Math.floor(Date.now() / 1000) + (v.expires_in ?? 3600);
  if (v.user?.id) cfg.user_id = v.user.id;
}

// 이메일·비밀번호로 로그인하고 설정 SQL 이 적용됐는지까지 확인 → 새 설정 객체
export async function connect({ url, key, email, password, fetchFn = fetch }) {
  const base = normalizeUrl(url);
  const k = String(key ?? '').trim();
  if (!k) throw new Error('공개 키(publishable key)를 넣어 주세요.');
  const v = await post(fetchFn, `${base}/auth/v1/token?grant_type=password`, k, null, { email: String(email ?? '').trim(), password });
  const cfg = { url: base, key: k, email: String(email ?? '').trim(), cursor: EPOCH, known: {}, last_ok: null, last_error: null };
  applySession(cfg, v);
  await post(fetchFn, `${base}/rest/v1/rpc/tw_pull`, k, cfg.access_token, { since: '2999-01-01T00:00:00Z' });
  return cfg;
}

async function ensureToken(cfg, fetchFn, onTokens) {
  if (cfg.access_token && Date.now() / 1000 < cfg.expires_at - 60) return;
  const v = await post(fetchFn, `${cfg.url}/auth/v1/token?grant_type=refresh_token`, cfg.key, null, { refresh_token: cfg.refresh_token });
  applySession(cfg, v);
  await onTokens?.(cfg); // 갱신 토큰은 한 번 쓰면 바뀌므로 바로 저장
}

/* ───────── 레코드 ↔ 줄 ───────── */

export function rowsToPush(state, known) {
  const rows = [];
  for (const k of COLLECTIONS) {
    for (const r of state[k] || []) {
      if (!r?.id || typeof r.updatedAt !== 'number') continue;
      if (known[`${k}:${r.id}`] === r.updatedAt) continue;
      rows.push({ kind: k, id: r.id, data: r, updated_at: r.updatedAt, deleted: !!r.deleted, device: r.device ?? '' });
    }
  }
  const st = state.settings || {};
  for (const [field, t] of Object.entries(st.stamps || {})) {
    if (typeof t !== 'number' || known[`settings:${field}`] === t) continue;
    rows.push({ kind: 'settings', id: field, data: { value: st[field] ?? null, updatedAt: t }, updated_at: t, deleted: false, device: '' });
  }
  return rows;
}

export function rowsToRemote(rows) {
  const remote = { layers: [], categories: [], workTypes: [], entries: [], settings: { stamps: {} } };
  for (const row of rows) {
    if (!row?.kind || !row?.id) continue;
    if (row.kind === 'settings') {
      remote.settings[row.id] = row.data?.value ?? null;
      remote.settings.stamps[row.id] = row.data?.updatedAt ?? 0;
    } else if (COLLECTIONS.includes(row.kind)) {
      remote[row.kind].push(row.data);
    }
  }
  return remote;
}

/*
 * 한 번 동기화.
 *   cfg          연결 설정 (이 함수가 고친다: 토큰, cursor, known, last_ok/last_error)
 *   withState    async (fn) => …  저장된 상태를 잠근 채 fn(state) 을 실행하고, fn 이 true 를 돌려주면 저장
 *   saveCfg      async (cfg) => …
 * 반환: { pulled, pushed, changed }
 */
export async function syncOnce({ cfg, withState, saveCfg, device, fetchFn = fetch }) {
  try {
    await ensureToken(cfg, fetchFn, saveCfg);
    const pulled = await post(fetchFn, `${cfg.url}/rest/v1/rpc/tw_pull`, cfg.key, cfg.access_token, { since: cfg.cursor || EPOCH });
    const rows = Array.isArray(pulled?.rows) ? pulled.rows : [];

    let changed = false;
    let push = [];
    await withState((state) => {
      const { changed: n, fixedRunning } = mergeRemote(state, rowsToRemote(rows), { now: Date.now(), device });
      for (const row of rows) {
        const v = row?.data?.updatedAt;
        if (row?.kind && row?.id && v !== undefined) cfg.known[`${row.kind}:${row.id}`] = v;
      }
      changed = n + fixedRunning > 0;
      push = rowsToPush(state, cfg.known);
      return changed;
    });

    for (let i = 0; i < push.length; i += CHUNK) {
      const chunk = push.slice(i, i + CHUNK);
      await post(fetchFn, `${cfg.url}/rest/v1/rpc/tw_push`, cfg.key, cfg.access_token, { rows: chunk });
      for (const r of chunk) cfg.known[`${r.kind}:${r.id}`] = r.updated_at;
    }
    if (pulled?.now) cfg.cursor = pulled.now;
    cfg.last_ok = Date.now();
    cfg.last_error = null;
    await saveCfg(cfg);
    return { pulled: rows.length, pushed: push.length, changed };
  } catch (e) {
    cfg.last_error = e?.message ?? String(e);
    await saveCfg(cfg);
    throw e;
  }
}
