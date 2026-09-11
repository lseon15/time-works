// 칠 목록 — 분류·작업 유형의 color 값은 이 키 중 하나. (5단계 관리 화면의 선택지)
export const FILLS = [
  { key: 'orange', name: '주황' },
  { key: 'ink', name: '먹' },
  { key: 'paper', name: '흰 종이' },
  { key: 'orange-hatch', name: '주황 빗금' },
  { key: 'paper-hatch', name: '흰 빗금' },
  { key: 'paper-dots', name: '흰 망점' },
  { key: 'orange-dots', name: '주황 망점' },
  { key: 'ink-dots', name: '먹 망점' },
];
export const fillClass = (key) => `fill fill-${FILLS.some((f) => f.key === key) ? key : 'paper'}`;
