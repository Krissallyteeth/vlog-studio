export const STATUSES = [
  { id: 'planning', label: '기획 중' },
  { id: 'shooting', label: '촬영 중' },
  { id: 'editing', label: '편집 중' },
  { id: 'done', label: '완료' },
];

export const TYPES = [
  { id: 'travel', label: '여행' },
  { id: 'daily', label: '일상' },
  { id: 'interior', label: '인테리어' },
  { id: 'lifestyle', label: '라이프스타일' },
  { id: 'other', label: '기타' },
];

export const VALUES = [
  { id: 'info', zh: '信息价值', ko: '새로운 정보' },
  { id: 'practical', zh: '实用价值', ko: '바로 써먹는 팁' },
  { id: 'emotion', zh: '情绪价值', ko: '위로·즐거움' },
  { id: 'aesthetic', zh: '审美价值', ko: '보기 좋은 화면' },
  { id: 'fun', zh: '娱乐价值', ko: '재미' },
  { id: 'company', zh: '陪伴价值', ko: '함께 있는 느낌' },
  { id: 'cognitive', zh: '认知价值', ko: '새로운 관점' },
  { id: 'inspire', zh: '启发价值', ko: '해보고 싶은 자극' },
  { id: 'identity', zh: '认同价值', ko: '나도 그래, 공감' },
];

export const SHOT_TYPES = [
  { id: 'env', zh: '环境镜头', ko: '환경과 공간', hint: '장소 전경, 분위기, 공간감' },
  { id: 'action', zh: '行动镜头', ko: '행동과 동작', hint: '걷기, 주문하기, 만들기' },
  { id: 'reaction', zh: '反应镜头', ko: '표정과 실제 반응', hint: '처음 본 순간, 맛본 순간' },
  { id: 'detail', zh: '细节镜头', ko: '디테일과 클로즈업', hint: '손, 질감, 소품, 음식' },
  { id: 'feeling', zh: '感受镜头', ko: '감정과 여운', hint: '창밖, 뒷모습, 노을, 정적' },
];

export const SORT_OPTIONS = [
  { id: 'shootDesc', label: '촬영일 최신순' },
  { id: 'shootAsc', label: '촬영일 오래된순' },
  { id: 'updatedDesc', label: '최근 수정순' },
  { id: 'createdDesc', label: '최근 생성순' },
];

export const DEFAULT_TARGET = { min: 120, max: 180 };

export const labelOf = (list, id) => list.find((x) => x.id === id)?.label ?? '';
