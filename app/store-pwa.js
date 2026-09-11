// 안드로이드(PWA) 저장소 어댑터 — store-tauri.js 와 같은 모양.
//   저장: 이 기기 브라우저의 IndexedDB. 저장할 때마다 저장된 내용과 합친 뒤 쓴다(동기화로 들어온 변경을 덮어쓰지 않게).
//   동기화: core/sync.js 로 Supabase 와 주고받음. 앱을 켰을 때, 화면으로 돌아왔을 때, 저장 직후, 켜져 있는 동안 1분마다.
//   명령: 맥의 Rust 명령 이름을 그대로 받아서(invoke) 이 기기에서 할 수 있는 것만 처리한다.
import { migrate } from '../core/migrate.js';
import { seedState } from '../core/seed.js';
import { mergeRemote } from '../core/rules.js';
import { connect as syncConnect, syncOnce } from '../core/sync.js';

export const DEVICE = 'android';
export const ctx = () => ({ now: Date.now(), device: DEVICE });

/* ───────── IndexedDB (키 두 개: state, sync) ───────── */

let dbp = null;
function db() {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('time-works', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function kv(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => res(req?.result);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}
const get = (k) => kv('readonly', (s) => s.get(k));
const put = (k, v) => kv('readwrite', (s) => s.put(v, k));
const del = (k) => kv('readwrite', (s) => s.delete(k));

// 읽고-합치고-쓰기를 한 줄로 세운다(저장과 동기화가 서로 끼어들지 않게)
let chain = Promise.resolve();
function locked(fn) {
  const p = chain.then(() => fn());
  chain = p.catch(() => {});
  return p;
}

/* ───────── 변경 알림 ───────── */

const changeListeners = [];   // { cb, owner }
const eventListeners = new Map();
const bc = 'BroadcastChannel' in globalThis ? new BroadcastChannel('time-works') : null;

function notifyChange(savedState) {
  for (const l of changeListeners) if (!l.owner || l.owner() !== savedState) l.cb();
  bc?.postMessage('changed'); // 같은 앱을 연 다른 탭
}
function emit(name, payload) {
  for (const cb of eventListeners.get(name) || []) cb(payload);
}

export function onExternalChange(cb, owner) {
  changeListeners.push({ cb, owner });
  return Promise.resolve(() => {});
}
export function listen(name, cb) {
  if (!eventListeners.has(name)) eventListeners.set(name, []);
  eventListeners.get(name).push(cb);
  return Promise.resolve(() => {});
}

/* ───────── 상태 ───────── */

let persistAsked = false;
export async function loadState() {
  if (!persistAsked && navigator.storage?.persist) { persistAsked = true; navigator.storage.persist().catch(() => {}); } // 브라우저가 임의로 지우지 않게
  return locked(async () => {
    const raw = await get('state');
    if (raw) return migrate(JSON.parse(raw));
    const s = seedState();
    await put('state', JSON.stringify(s));
    return s;
  });
}

export async function saveState(state) {
  await locked(async () => {
    const incoming = JSON.parse(JSON.stringify(state));
    const raw = await get('state');
    let extra = 0;
    if (raw) {
      const r = mergeRemote(incoming, JSON.parse(raw), ctx());
      extra = r.changed + r.fixedRunning;
    }
    await put('state', JSON.stringify(incoming));
    if (extra > 0) for (const k of Object.keys(incoming)) state[k] = incoming[k];
  });
  notifyChange(state);
  scheduleSync(1500);
}

/* ───────── 동기화 ───────── */

let busy = false;
let timer = null;
const getCfg = () => get('sync');
const putCfg = (c) => put('sync', c);

async function status() {
  const c = await getCfg();
  return c ? { connected: true, email: c.email, url: c.url, lastOk: c.last_ok, lastError: c.last_error, busy } : { connected: false, busy };
}
async function emitStatus() { emit('sync-status', await status()); }

function scheduleSync(ms) {
  clearTimeout(timer);
  timer = setTimeout(runSync, ms);
}

async function runSync() {
  const cfg = await getCfg();
  if (!cfg) return;
  if (busy) { scheduleSync(3000); return; }
  busy = true;
  emitStatus();
  try {
    const out = await syncOnce({
      cfg,
      device: DEVICE,
      saveCfg: async (c) => { if (await getCfg()) await putCfg(c); }, // 도중에 연결을 끊었으면 되살리지 않음
      withState: (fn) => locked(async () => {
        const raw = await get('state');
        if (!raw) return;
        const s = migrate(JSON.parse(raw));
        if (fn(s)) await put('state', JSON.stringify(s));
      }),
    });
    if (out.changed) notifyChange(null); // 모든 화면 다시 불러오기
  } catch { /* 이유는 cfg.last_error 에 남아 설정 화면에 보인다 */ }
  busy = false;
  emitStatus();
}

/* ───────── 맥 명령 흉내 ───────── */

export async function invoke(cmd, args = {}) {
  switch (cmd) {
    case 'sync_status': return status();
    case 'sync_connect': {
      const cfg = await syncConnect(args);
      await putCfg(cfg);
      scheduleSync(300);
      return status();
    }
    case 'sync_disconnect': await del('sync'); await emitStatus(); return status();
    case 'sync_now': scheduleSync(0); return null;
    case 'open_stats': dispatchEvent(new CustomEvent('tw-nav', { detail: args.page || 'stats' })); return null;
    case 'close_panel': return null;
    case 'data_path': return '이 기기의 브라우저 저장소(IndexedDB)';
    default: throw new Error(`이 기기에서는 쓸 수 없는 기능이에요 (${cmd})`);
  }
}

/* ───────── 시작 ───────── */

export function start() {
  bc && (bc.onmessage = () => { for (const l of changeListeners) l.cb(); });
  scheduleSync(1000);
  setInterval(() => { if (document.visibilityState === 'visible') runSync(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(300); });
}
