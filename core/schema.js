// Time Works — 데이터 구조 기준점 (맥·안드로이드 공통)
// 이 파일이 스키마의 유일한 기준이다. 필드를 바꾸면 여기부터 바꾸고 SCHEMA_VERSION 을 올린 뒤
// migrate.js 에 옛 데이터 변환을 추가한다.

export const SCHEMA_VERSION = 2;

/*
 * 저장 상태 전체
 * {
 *   version:    SCHEMA_VERSION,
 *   layers:     Layer[],
 *   categories: Category[],
 *   workTypes:  WorkType[],
 *   entries:    Entry[],
 *   settings:   Settings,
 * }
 *
 * 모든 레코드 공통 (동기화용)
 *   id         UUID. 기기 간에 겹치지 않음
 *   createdAt  생성 시각 (epoch ms)
 *   updatedAt  마지막 수정 시각 (epoch ms) — 충돌 시 큰 쪽이 이김
 *   deleted    true 면 삭제 표시(tombstone). 실제로 지우지 않아야 다른 기기에 삭제가 전달됨
 *   device     마지막으로 수정한 기기 ('mac' | 'android' ...)
 *
 * Layer (레이어) — 분류 단계에 붙이는 이름. 예: 대분류 → 장르 → 제작 → 작품
 *   name       이름
 *   order      얕은 쪽이 작다. 사이에 끼워 넣을 때는 두 값의 중간값을 쓴다(다른 레이어를 건드리지 않게)
 *
 * Category (분류) — 깊이 제한 없는 트리
 *   parentId   상위 분류 id. 최상위는 null
 *   layerId    이 분류의 레이어. 깊이와 무관하게 분류마다 지정(드라마 바로 아래 '작품' 가능)
 *              규칙: 하위 분류의 레이어는 항상 상위보다 깊다. 비어 있으면 상위 다음 레이어로 추정
 *   name       이름. 다른 가지에서는 같은 이름 허용 (예: 자체제작 ×2) → 화면에는 경로로 표시
 *   color      칠 키('orange', 'ink', 'paper-dots' … web/app/fills.js) 또는 null.
 *              null 이면 가장 가까운 상위 분류의 칠을 물려받음. 3색 팔레트라 색 대신 스크린톤으로 구분
 *   order      같은 상위 안에서의 정렬 순서
 *   archived   보관. 선택 목록에서만 숨김. 기록·통계에는 그대로 남음
 *
 * WorkType (작업 유형) — 한 단계짜리 목록, 모든 분류 공통
 *   name, color(칠 키), order, archived
 *
 * Entry (기록)
 *   categoryId  기록한 분류 (어느 단계든 가능)
 *   workTypeId  작업 유형 (필수)
 *   start       시작 시각 (epoch ms)
 *   end         종료 시각 (epoch ms). null = 진행 중. 모든 기기 통틀어 진행 중 기록은 하나
 *   note        메모 (선택)
 *   자정을 넘겨도 한 덩어리로 저장. 날짜별 분할은 통계 계산 때만 한다.
 *
 * Settings
 *   dayStartHour  하루가 시작되는 시각 (0~23). 기본 0 = 자정. 4 로 두면 새벽 4시 전 작업은 전날로 계산
 *   weekStartsOn  한 주의 시작 요일. 1 = 월요일 (0 = 일요일)
 *   stamps        { 항목: 바꾼 시각 } — 동기화 때 항목마다 나중에 바꾼 쪽을 고르기 위함
 */

export const DEFAULT_SETTINGS = Object.freeze({
  dayStartHour: 0,
  weekStartsOn: 1,
});

export const COLLECTIONS = ['layers', 'categories', 'workTypes', 'entries'];

export function newId() {
  return globalThis.crypto.randomUUID();
}

function base(ctx, id) {
  return {
    id: id ?? newId(),
    createdAt: ctx.now,
    updatedAt: ctx.now,
    deleted: false,
    device: ctx.device,
  };
}

const cleanName = (name, what) => {
  const n = String(name ?? '').trim();
  if (!n) throw new Error(`${what} 이름이 비어 있음`);
  return n;
};

export function makeLayer(ctx, { id, name, order = 0 }) {
  return { ...base(ctx, id), name: cleanName(name, '레이어'), order };
}

export function makeCategory(ctx, { id, parentId = null, layerId = null, name, color = null, order = 0 }) {
  return { ...base(ctx, id), parentId, layerId, name: cleanName(name, '분류'), color, order, archived: false };
}

export function makeWorkType(ctx, { id, name, color = null, order = 0 }) {
  return { ...base(ctx, id), name: cleanName(name, '작업 유형'), color, order, archived: false };
}

export function makeEntry(ctx, { id, categoryId, workTypeId, start, end = null, note = '' }) {
  if (!categoryId) throw new Error('분류가 지정되지 않음');
  if (!workTypeId) throw new Error('작업 유형이 지정되지 않음');
  if (!Number.isFinite(start)) throw new Error('시작 시각이 올바르지 않음');
  if (end !== null && !(end > start)) throw new Error('종료 시각은 시작 시각보다 뒤여야 함');
  return { ...base(ctx, id), categoryId, workTypeId, start, end, note };
}

export function emptyState() {
  return {
    version: SCHEMA_VERSION,
    layers: [],
    categories: [],
    workTypes: [],
    entries: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}
