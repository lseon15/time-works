// 초기 레이어·분류·작업 유형.
// id 를 고정값으로 박아둔다 — 맥과 폰이 각각 처음 실행하며 초기 데이터를 넣어도
// 같은 id 라서 동기화 때 중복으로 두 벌이 생기지 않는다.
// 초기 데이터 생성 시각은 0 → 사용자가 한 번이라도 고치면 그 수정이 항상 이긴다.

import { makeLayer, makeCategory, makeWorkType, emptyState } from './schema.js';

const SEED_CTX = { now: 0, device: 'seed' };

const L = {
  대분류: '064bf8d2-d560-4b8c-a900-66d552062ea7',
  장르: '63187abf-de85-4a0f-8158-741243cdc6f7',
  제작: '81b2cac4-1956-4bc7-b362-ae9f2c492645',
  작품: 'eedefcb5-a3f9-4996-90c2-2fb3c5742ae5',
};
const LAYERS = [[L.대분류, '대분류'], [L.장르, '장르'], [L.제작, '제작'], [L.작품, '작품']];

// [id, 이름, 상위 id, 레이어, 칠]  — 칠(web/app/fills.js 의 키) null 은 상위 칠을 물려받음
const CATEGORIES = [
  ['722d0d02-13d8-493a-8915-d176d7a219fe', '게임', null, L.대분류, 'orange'],
  ['47d7edad-9bc1-49b1-b638-2ef62f874053', '시나리오 게임', '722d0d02-13d8-493a-8915-d176d7a219fe', L.장르, null],
  ['8ff07cfd-95a4-4c8b-9d3f-28e63d1fca5d', '퍼블리싱', '47d7edad-9bc1-49b1-b638-2ef62f874053', L.제작, null],
  ['89520af5-339d-4eef-9c5c-1f009803f6ab', '매거진', '8ff07cfd-95a4-4c8b-9d3f-28e63d1fca5d', L.작품, null],
  ['d1c280d2-2ff3-490b-859c-216c6feb08e7', '프렌드십', '8ff07cfd-95a4-4c8b-9d3f-28e63d1fca5d', L.작품, null],
  ['5d0928dc-4d89-420a-8da6-89266e254cc1', '자체제작', '47d7edad-9bc1-49b1-b638-2ef62f874053', L.제작, null],
  ['523b2428-ecbe-4e6a-a1e1-0454b7f18655', '시냅티드', '5d0928dc-4d89-420a-8da6-89266e254cc1', L.작품, null],
  ['e2af6c67-9e65-45f2-bbe4-52d18a2da05e', 'MTL', '5d0928dc-4d89-420a-8da6-89266e254cc1', L.작품, null],
  ['5853f215-8afb-4b5b-826b-c088c5730d37', '비시나리오게임', '722d0d02-13d8-493a-8915-d176d7a219fe', L.장르, null],
  ['d8122e81-ab71-4d68-b782-ddbf583e8246', '비시나리오퍼블리싱', '5853f215-8afb-4b5b-826b-c088c5730d37', L.제작, null],
  ['809ffc85-8686-40a5-8b5f-3cf84f98f71b', '자체제작', '5853f215-8afb-4b5b-826b-c088c5730d37', L.제작, null],
  ['4eaf1017-dcfb-4efd-b634-86988d4dda9a', '드라마', null, L.대분류, 'ink'],
  ['4b4d8a78-7603-42d8-88b3-965523e5a257', '운수', '4eaf1017-dcfb-4efd-b634-86988d4dda9a', L.작품, null],
  ['b59fac70-db63-4f7c-89b5-30f1c9e9a1ae', '디텍티브', '4eaf1017-dcfb-4efd-b634-86988d4dda9a', L.작품, null],
  ['2aa0cd95-bf74-4c2d-a118-68111d58cb37', 'weirdosmos', null, L.대분류, 'paper-dots'],
  ['e100a04d-ed80-4de8-8339-689c06850a38', 'Next Stop', '2aa0cd95-bf74-4c2d-a118-68111d58cb37', L.작품, null],
  ['4ca9fbc2-db6c-4b78-b331-58462924fc36', 'Killer Type', '2aa0cd95-bf74-4c2d-a118-68111d58cb37', L.작품, null],
];

const WORK_TYPES = [
  ['507595f9-1f15-4e55-8f62-bc4577320dff', '자료 조사', 'paper-dots'],
  ['cfcfd186-e4c0-43d8-bc6e-5da8ce94cc7c', '실작업', 'orange'],
  ['2006584d-c124-4b2b-bfc6-332177ad19b1', '마케팅', 'ink'],
  ['18b6f1dd-e211-4051-89a3-27cc2e97e463', '제작', 'orange-hatch'],
  ['9f21d969-235d-4311-8558-aa49e6cd716a', '유통', 'paper-hatch'],
];

export const seedLayers = () => LAYERS.map(([id, name], order) => makeLayer(SEED_CTX, { id, name, order }));

// 초기 분류 id → 레이어 id (v1 데이터 변환용)
export const SEED_LAYER_OF = Object.freeze(Object.fromEntries(CATEGORIES.map(([id, , , layer]) => [id, layer])));

export function seedState() {
  const s = emptyState();
  s.layers = seedLayers();
  const orderIn = new Map(); // 상위별 순서 카운터
  for (const [id, name, parentId, layerId, color] of CATEGORIES) {
    const k = parentId ?? 'root';
    const order = orderIn.get(k) ?? 0;
    orderIn.set(k, order + 1);
    s.categories.push(makeCategory(SEED_CTX, { id, name, parentId, layerId, color, order }));
  }
  WORK_TYPES.forEach(([id, name, color], order) => {
    s.workTypes.push(makeWorkType(SEED_CTX, { id, name, color, order }));
  });
  return s;
}

// 테스트에서 이름 대신 id 로 찾기 쉽게
const C = CATEGORIES.map((c) => c[0]);
export const SEED_IDS = Object.freeze({
  게임: C[0], 시나리오게임: C[1], 퍼블리싱: C[2], 매거진: C[3], 프렌드십: C[4],
  시나리오_자체제작: C[5], 시냅티드: C[6], MTL: C[7],
  비시나리오게임: C[8], 비시나리오퍼블리싱: C[9], 비시나리오_자체제작: C[10],
  드라마: C[11], 운수: C[12], 디텍티브: C[13],
  weirdosmos: C[14], NextStop: C[15], KillerType: C[16],
  자료조사: WORK_TYPES[0][0], 실작업: WORK_TYPES[1][0], 마케팅: WORK_TYPES[2][0], 제작: WORK_TYPES[3][0], 유통: WORK_TYPES[4][0],
  L대분류: L.대분류, L장르: L.장르, L제작: L.제작, L작품: L.작품,
});
