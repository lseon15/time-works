// 화면 코드가 쓰는 저장소 — 맥 앱(Tauri)이면 store-tauri.js, 브라우저(안드로이드 PWA)면 store-pwa.js
import * as tauri from './store-tauri.js';
import * as pwa from './store-pwa.js';

const impl = globalThis.__TAURI__ ? tauri : pwa;
impl.start();

export const IS_DESKTOP = impl === tauri;
export const DEVICE = impl.DEVICE;
export const ctx = () => impl.ctx();
export const invoke = (cmd, args) => impl.invoke(cmd, args);
export const loadState = () => impl.loadState();
export const saveState = (state) => impl.saveState(state);
export const listen = (name, cb) => impl.listen(name, cb);
export const onExternalChange = (cb, owner) => impl.onExternalChange(cb, owner);

// 날짜 표기
const WD = ['일', '월', '화', '수', '목', '금', '토'];
export const fmtDay = (ts) => { const d = new Date(ts); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WD[d.getDay()]}요일`; };
export const fmtHMS = (ms) => {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
