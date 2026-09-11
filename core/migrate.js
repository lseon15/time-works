// 저장된 옛 데이터를 현재 스키마로 변환. 불러올 때마다 거친다(이미 최신이면 그대로).
import { SCHEMA_VERSION, DEFAULT_SETTINGS, COLLECTIONS, emptyState } from './schema.js';
import { seedLayers, SEED_LAYER_OF } from './seed.js';

export function migrate(raw) {
  const s = emptyState();
  for (const k of COLLECTIONS) s[k] = Array.isArray(raw?.[k]) ? raw[k] : [];
  s.settings = { ...DEFAULT_SETTINGS, ...(raw?.settings || {}) };
  const from = raw?.version ?? 1;

  // v1 → v2: 레이어 도입. 초기 레이어 4개를 넣고, 초기 분류는 정해둔 레이어로.
  // 사용자가 만든 분류는 비워 두면 화면·계산에서 '상위 다음 레이어'로 추정된다.
  if (from < 2) {
    if (!s.layers.length) s.layers = seedLayers();
    for (const c of s.categories) {
      if (c.layerId === undefined) c.layerId = SEED_LAYER_OF[c.id] ?? null;
    }
  }

  s.version = SCHEMA_VERSION;
  return s;
}
