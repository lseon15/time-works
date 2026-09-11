// 맥(Tauri) 저장소 어댑터. 안드로이드 PWA 는 store-pwa.js. 화면 코드는 store.js 를 통해 둘 중 하나를 쓴다.
import { migrate } from '../core/migrate.js';
import { seedState } from '../core/seed.js';
import { dayKey } from '../core/engine.js';

const T = window.__TAURI__;
export const DEVICE = 'mac';
export const ctx = () => ({ now: Date.now(), device: DEVICE });
export const invoke = (cmd, args) => T.core.invoke(cmd, args);

// 파일이 없으면(첫 실행) 초기 분류·작업 유형으로 만들어 저장
export async function loadState() {
  const raw = await invoke('load_state');
  if (raw) return migrate(JSON.parse(raw));
  const s = seedState();
  await saveState(s);
  return s;
}

// 변경할 때마다 바로 저장 (타이머 시작 순간 디스크에 남아야 강제 종료에도 안전)
// 파일에 동기화로 들어온 더 새로운 내용이 있으면 Rust 가 합친 결과를 돌려준다 → 그대로 반영
export async function saveState(state) {
  const merged = await invoke('save_state', { json: JSON.stringify(state), backupKey: dayKey(Date.now(), state.settings) });
  if (merged) {
    const m = migrate(JSON.parse(merged));
    for (const k of Object.keys(m)) state[k] = m[k];
  }
}

// Rust 가 보내는 이벤트 듣기
export const listen = (name, cb) => T.event.listen(name, (e) => cb(e.payload));

// 다른 창에서 저장하면 알림 → 다시 불러오기 (owner 는 PWA 에서만 쓴다)
export function onExternalChange(cb, _owner) {
  const me = T.window.getCurrentWindow().label;
  return T.event.listen('state-changed', (e) => { if (e.payload !== me) cb(); });
}

export function start() {}
