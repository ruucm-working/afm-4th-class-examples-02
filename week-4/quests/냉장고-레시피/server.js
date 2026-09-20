// ============================================
// 냉장고 파먹기 API 서버 (Express + PostgreSQL)
// ============================================
//
// 재료 · 레시피 · 장보기 목록을 Supabase 의 PostgreSQL 에 저장한다.
// 테이블이 비어 있으면 처음 한 번 예시 데이터를 넣는다 (seed).
// 회원가입 · 로그인은 JWT 로 한다. /api/auth/* 를 뺀 모든 API 는 토큰이 있어야 쓸 수 있다.
//
// 로컬 실행  : node server.js  →  http://localhost:6004
// Vercel 배포: module.exports = app 으로 서버리스 함수로 동작

const express = require('express');
const path = require('path');
const { Pool, types } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// ── .env 로드 (Node 20.12+ 내장, 없으면 조용히 넘어간다) ──────
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // .env 가 없으면 실제 환경변수(Vercel 설정 등)를 그대로 사용한다
}

// DATE 컬럼은 JS Date 로 바꾸지 않고 'YYYY-MM-DD' 문자열 그대로 받는다
// (Date 로 바뀌면 시간대 때문에 하루씩 밀린다)
types.setTypeParser(1082, (v) => v);

const app = express();
const PORT = process.env.PORT || 6004;

// ── DB 연결 ──────────────────────────────────
//
// 접속 정보는 코드에 박지 않는다. .env 의 DATABASE_URL 에서만 읽는다.
// Vercel 환경변수에는 줄바꿈이 딸려오는 경우가 있어 항상 .trim() 한다.

const DATABASE_URL = (process.env.DATABASE_URL || '').trim();

if (!DATABASE_URL) {
  console.error('✗ DATABASE_URL 이 없습니다. .env.example 을 .env 로 복사하고 값을 채우세요.');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3, // 서버리스에서는 커넥션을 조금만 연다
});

// ── OpenAI 설정 ──────────────────────────────
//
// 키는 .env / Vercel 환경변수의 OPENAI_API_KEY 에서만 읽는다.
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();
const OPENAI_MODEL = (process.env.OPENAI_MODEL || 'gpt-5.4-mini').trim();

// ── JWT 설정 ─────────────────────────────────
//
// 토큰 서명 키는 .env / Vercel 환경변수의 JWT_SECRET 에서만 읽는다.
// 키가 바뀌면 이미 발급된 토큰은 전부 무효가 된다 (다시 로그인해야 한다).
const JWT_SECRET = (process.env.JWT_SECRET || '').trim();
const JWT_EXPIRES_IN = '7d';

if (!JWT_SECRET) {
  console.error('✗ JWT_SECRET 이 없습니다. .env 에 긴 랜덤 문자열을 넣으세요.');
}

// 유통기한은 한국 날짜 기준으로 계산한다
const TODAY_KST = `(NOW() AT TIME ZONE 'Asia/Seoul')::date`;

// ── 예시 데이터 (seed) ────────────────────────
//
// 페르소나: 30대 여성 직장인 · 식단관리 빡세게 하는 중
//   - 고단백 · 저탄수 · 저당, 하루 1,400kcal 안팎 / 단백질 100g 이상 목표
//   - 일요일 밤에 3일치 밀프렙, 평일 점심은 도시락, 아침은 오버나이트 오트밀
//   - 주 4회 운동(필라테스 · 웨이트) 전후 간식까지 챙겨 먹음
//   - 쿠팡 새벽배송으로 닭가슴살·냉동 연어·블루베리를 대량 구매
//
// days = 오늘 기준 유통기한까지 남은 날 (음수면 이미 지남)
const SEED_INGREDIENTS = [
  // 단백질
  { name: '닭가슴살', emoji: '🍗', category: '육류·해산물', qty: 2, unit: '팩', storage: 'fridge', days: 1 },   // 밀프렙용으로 꺼내 해동 중
  { name: '닭가슴살', emoji: '🍗', category: '육류·해산물', qty: 10, unit: '팩', storage: 'freezer', days: 75 }, // 새벽배송 30팩 박스 남은 것
  { name: '계란', emoji: '🥚', category: '유제품·계란', qty: 14, unit: '개', storage: 'fridge', days: 12 },
  { name: '소고기 우둔살', emoji: '🥩', category: '육류·해산물', qty: 300, unit: 'g', storage: 'fridge', days: 3 },
  { name: '연어', emoji: '🐟', category: '육류·해산물', qty: 4, unit: '조각', storage: 'freezer', days: 40 },
  { name: '두부', emoji: '🧈', category: '기타', qty: 1, unit: '모', storage: 'fridge', days: 2 },
  { name: '참치캔', emoji: '🥫', category: '육류·해산물', qty: 4, unit: '캔', storage: 'pantry', days: 400 },
  { name: '단백질 파우더', emoji: '💪', category: '기타', qty: 1, unit: '통', storage: 'pantry', days: 210 },
  // 유제품
  { name: '그릭요거트', emoji: '🥣', category: '유제품·계란', qty: 450, unit: 'g', storage: 'fridge', days: 5 },
  { name: '코티지치즈', emoji: '🧀', category: '유제품·계란', qty: 200, unit: 'g', storage: 'fridge', days: 4 },
  { name: '무가당 아몬드우유', emoji: '🥛', category: '유제품·계란', qty: 1, unit: 'L', storage: 'fridge', days: 6 },
  { name: '무가당 두유', emoji: '🥛', category: '유제품·계란', qty: 1, unit: '팩', storage: 'fridge', days: -3 },   // 개봉하고 잊어버림
  // 채소
  { name: '브로콜리', emoji: '🥦', category: '채소', qty: 1, unit: '송이', storage: 'fridge', days: 3 },
  { name: '시금치', emoji: '🥬', category: '채소', qty: 1, unit: '봉', storage: 'fridge', days: 0 },
  { name: '로메인 샐러드 믹스', emoji: '🥗', category: '채소', qty: 1, unit: '봉', storage: 'fridge', days: -2 }, // 바빠서 샐러드를 못 먹음
  { name: '방울토마토', emoji: '🍅', category: '채소', qty: 250, unit: 'g', storage: 'fridge', days: 2 },
  { name: '양배추', emoji: '🥬', category: '채소', qty: 0.5, unit: '통', storage: 'fridge', days: 9 },
  { name: '오이', emoji: '🥒', category: '채소', qty: 2, unit: '개', storage: 'fridge', days: 4 },
  { name: '파프리카', emoji: '🫑', category: '채소', qty: 2, unit: '개', storage: 'fridge', days: 6 },
  { name: '고구마', emoji: '🍠', category: '채소', qty: 5, unit: '개', storage: 'pantry', days: 10 },
  // 과일
  { name: '아보카도', emoji: '🥑', category: '과일', qty: 1, unit: '개', storage: 'fridge', days: 1 },            // 딱 먹기 좋게 익음
  { name: '블루베리', emoji: '🫐', category: '과일', qty: 1, unit: '봉', storage: 'freezer', days: 120 },
  { name: '바나나', emoji: '🍌', category: '과일', qty: 2, unit: '개', storage: 'pantry', days: 3 },
  { name: '레몬', emoji: '🍋', category: '과일', qty: 2, unit: '개', storage: 'fridge', days: 8 },
  // 탄수화물
  { name: '현미밥', emoji: '🍚', category: '기타', qty: 6, unit: '개(130g)', storage: 'freezer', days: 30 },
  { name: '곤약밥', emoji: '🍚', category: '기타', qty: 3, unit: '팩', storage: 'pantry', days: 60 },
  { name: '오트밀', emoji: '🌾', category: '기타', qty: 1, unit: '봉', storage: 'pantry', days: 150 },
  { name: '아몬드', emoji: '🥜', category: '기타', qty: 1, unit: '봉', storage: 'pantry', days: 80 },
  // 양념
  { name: '올리브유', emoji: '🫒', category: '양념·소스', qty: 1, unit: '병', storage: 'pantry', days: 300 },
  { name: '저염 간장', emoji: '🫙', category: '양념·소스', qty: 1, unit: '병', storage: 'fridge', days: 180 },
  { name: '발사믹 식초', emoji: '🍶', category: '양념·소스', qty: 1, unit: '병', storage: 'pantry', days: 250 },
  { name: '스리라차', emoji: '🌶️', category: '양념·소스', qty: 1, unit: '병', storage: 'fridge', days: 200 },
  { name: '알룰로스', emoji: '🍯', category: '양념·소스', qty: 1, unit: '병', storage: 'pantry', days: 365 },
];

// kcal 는 1인분(1회분) 기준. 설명 끝에 탄단지를 적는다.
const SEED_RECIPES = [
  {
    title: '닭가슴살 브로콜리 현미 도시락', emoji: '🍱', color: 'from-lime-100 to-emerald-100', time: 30, difficulty: '보통', servings: 3, kcal: 430, favorite: true,
    tags: ['밀프렙', '점심 도시락', '고단백'],
    desc: '일요일 밤에 3일치를 한 번에 싸 두는 기본 도시락. 단백질 45g · 탄수 42g · 지방 8g',
    ingredients: [
      { name: '닭가슴살', amount: '450g(3팩)' }, { name: '브로콜리', amount: '1송이' }, { name: '현미밥', amount: '3개(390g)' },
      { name: '올리브유', amount: '1큰술' }, { name: '저염 간장', amount: '1큰술' }, { name: '레몬', amount: '1/2개' },
    ],
    steps: [
      '닭가슴살은 포크로 찔러 레몬즙, 올리브유, 후추에 20분 재운다.',
      '에어프라이어 180℃에서 12분 굽고 뒤집어 6분 더 굽는다.',
      '브로콜리는 한입 크기로 잘라 끓는 물에 1분 데친 뒤 찬물에 헹군다.',
      '현미밥을 전자레인지에 2분 데워 도시락통 3개에 130g씩 나눠 담는다.',
      '닭가슴살을 썰어 150g씩 올리고 브로콜리를 곁들인 뒤, 저염 간장은 따로 챙긴다.',
    ],
  },
  {
    title: '블루베리 오버나이트 오트밀', emoji: '🥣', color: 'from-indigo-100 to-violet-100', time: 5, difficulty: '쉬움', servings: 1, kcal: 330, favorite: true,
    tags: ['아침', '전날 밤 준비', '저당'],
    desc: '자기 전 5분이면 끝나는 출근길 아침. 단백질 22g · 탄수 38g · 지방 9g',
    ingredients: [
      { name: '오트밀', amount: '40g' }, { name: '그릭요거트', amount: '100g' }, { name: '무가당 아몬드우유', amount: '150ml' },
      { name: '블루베리', amount: '50g' }, { name: '알룰로스', amount: '1작은술' },
    ],
    steps: [
      '밀폐 유리병에 오트밀, 그릭요거트, 아몬드우유를 넣고 잘 섞는다.',
      '알룰로스를 넣어 단맛을 맞춘다.',
      '냉동 블루베리를 위에 올리고 뚜껑을 닫아 냉장고에서 하룻밤 불린다.',
      '아침에 그대로 들고 나가 먹는다. 너무 되직하면 아몬드우유를 조금 더 넣는다.',
    ],
  },
  {
    title: '연어 아보카도 포케', emoji: '🐟', color: 'from-orange-100 to-rose-100', time: 15, difficulty: '쉬움', servings: 1, kcal: 520,
    tags: ['주말 치팅 대신', '좋은 지방'],
    desc: '먹고 싶은 게 많은 날 한 그릇으로 달래는 포케. 단백질 32g · 탄수 45g · 지방 22g',
    ingredients: [
      { name: '현미밥', amount: '130g' }, { name: '연어', amount: '1조각(100g)' }, { name: '아보카도', amount: '1/2개' },
      { name: '오이', amount: '1/2개' }, { name: '저염 간장', amount: '1큰술' }, { name: '구운 김', amount: '1장' }, { name: '통깨', amount: '약간' },
    ],
    steps: [
      '냉동 연어는 냉장실에서 반나절 해동해 키친타월로 물기를 닦고 깍둑 썬다.',
      '아보카도와 오이도 연어와 비슷한 크기로 썬다.',
      '저염 간장에 레몬즙 몇 방울을 섞어 연어를 5분 재운다.',
      '현미밥 위에 재료를 올리고 구운 김을 부숴 뿌린 뒤 통깨로 마무리한다.',
    ],
  },
  {
    title: '두부 시금치 스크램블', emoji: '🍳', color: 'from-yellow-100 to-lime-100', time: 10, difficulty: '쉬움', servings: 1, kcal: 290,
    tags: ['아침', '저탄수', '10분'],
    desc: '계란과 두부를 같이 써서 양은 많고 칼로리는 낮게. 단백질 24g · 탄수 9g · 지방 17g',
    ingredients: [
      { name: '두부', amount: '1/2모(150g)' }, { name: '계란', amount: '2개' }, { name: '시금치', amount: '1줌' },
      { name: '방울토마토', amount: '6개' }, { name: '올리브유', amount: '1작은술' },
    ],
    steps: [
      '두부는 키친타월로 눌러 물기를 뺀다.',
      '올리브유 두른 팬에 두부를 으깨 넣고 수분이 날아갈 때까지 볶는다.',
      '시금치와 반 가른 방울토마토를 넣고 30초 볶는다.',
      '계란을 풀어 넣고 약불에서 부드럽게 저어 익힌 뒤 소금, 후추로 간한다.',
    ],
  },
  {
    title: '곤약밥 소고기 볶음밥', emoji: '🍛', color: 'from-amber-100 to-orange-100', time: 15, difficulty: '쉬움', servings: 1, kcal: 380,
    tags: ['저탄수', '저녁', '볶음밥 당길 때'],
    desc: '볶음밥이 당길 때 곤약밥으로 탄수를 절반으로. 단백질 33g · 탄수 22g · 지방 16g',
    ingredients: [
      { name: '곤약밥', amount: '1팩' }, { name: '소고기 우둔살', amount: '100g' }, { name: '파프리카', amount: '1/2개' },
      { name: '계란', amount: '1개' }, { name: '저염 간장', amount: '1큰술' }, { name: '스리라차', amount: '1작은술' },
    ],
    steps: [
      '우둔살은 잘게 다지고 파프리카는 작게 깍둑 썬다.',
      '달군 팬에 소고기를 먼저 볶다가 파프리카를 넣는다.',
      '곤약밥을 넣고 저염 간장을 둘러 센 불에 수분을 날리며 볶는다.',
      '한쪽으로 밀고 계란을 스크램블해 섞은 뒤 스리라차를 곁들인다.',
    ],
  },
  {
    title: '우둔살 스테이크 샐러드', emoji: '🥗', color: 'from-green-100 to-teal-100', time: 20, difficulty: '보통', servings: 1, kcal: 410,
    tags: ['저녁', '저탄수', '운동한 날'],
    desc: '웨이트 한 날 저녁. 소고기로 철분까지 챙긴다. 단백질 38g · 탄수 12g · 지방 22g',
    ingredients: [
      { name: '소고기 우둔살', amount: '150g' }, { name: '로메인 샐러드 믹스', amount: '1봉' }, { name: '방울토마토', amount: '8개' },
      { name: '발사믹 식초', amount: '1큰술' }, { name: '올리브유', amount: '1큰술' },
    ],
    steps: [
      '우둔살은 실온에 15분 두고 소금, 후추를 뿌린다.',
      '센 불에 앞뒤로 2분씩 구운 뒤 5분 레스팅하고 얇게 썬다.',
      '발사믹 식초와 올리브유를 1:1로 섞어 드레싱을 만든다.',
      '샐러드 믹스와 방울토마토 위에 고기를 올리고 드레싱을 뿌린다.',
    ],
  },
  {
    title: '그릭요거트 프로틴 볼', emoji: '🫐', color: 'from-sky-100 to-indigo-100', time: 3, difficulty: '쉬움', servings: 1, kcal: 310, favorite: true,
    tags: ['간식', '운동 후', '달달한 거 당길 때'],
    desc: '밤에 단 게 당길 때 먹는 디저트 대용. 단백질 35g · 탄수 20g · 지방 9g',
    ingredients: [
      { name: '그릭요거트', amount: '150g' }, { name: '단백질 파우더', amount: '1/2스쿱' }, { name: '블루베리', amount: '40g' }, { name: '아몬드', amount: '10알' },
    ],
    steps: [
      '그릭요거트에 단백질 파우더를 넣고 뭉치지 않게 잘 섞는다.',
      '냉동 블루베리를 올리고 5분 두면 살짝 녹으면서 소스처럼 된다.',
      '아몬드를 굵게 다져 뿌린다.',
    ],
  },
  {
    title: '바나나 프로틴 쉐이크', emoji: '🥤', color: 'from-yellow-100 to-amber-100', time: 3, difficulty: '쉬움', servings: 1, kcal: 320,
    tags: ['운동 후', '초간단'],
    desc: '필라테스 끝나고 30분 안에 마시는 한 잔. 단백질 28g · 탄수 40g · 지방 6g',
    ingredients: [
      { name: '바나나', amount: '1개' }, { name: '단백질 파우더', amount: '1스쿱' }, { name: '무가당 아몬드우유', amount: '250ml' }, { name: '오트밀', amount: '20g' },
    ],
    steps: [
      '바나나를 잘라 블렌더에 넣는다.',
      '단백질 파우더, 아몬드우유, 오트밀을 넣는다.',
      '얼음 3~4개를 넣고 30초 간다.',
    ],
  },
  {
    title: '참치 양배추 쌈', emoji: '🥬', color: 'from-emerald-50 to-lime-100', time: 15, difficulty: '쉬움', servings: 1, kcal: 280,
    tags: ['저녁', '저탄수', '야근한 날'],
    desc: '늦게 퇴근한 날 불 안 쓰고 먹는 쌈. 단백질 27g · 탄수 15g · 지방 10g',
    ingredients: [
      { name: '참치캔', amount: '1캔(기름 뺀 것)' }, { name: '양배추', amount: '1/6통' }, { name: '오이', amount: '1/2개' },
      { name: '저당 쌈장', amount: '1큰술' }, { name: '스리라차', amount: '약간' },
    ],
    steps: [
      '양배추 잎을 떼어 전자레인지에 3분 쪄서 식힌다.',
      '참치는 체에 밭쳐 기름을 최대한 빼고 뜨거운 물을 한 번 부어 헹군다.',
      '오이는 채 썬다.',
      '양배추에 참치, 오이, 저당 쌈장을 올려 싸 먹는다.',
    ],
  },
  {
    title: '시금치 파프리카 에그 머핀', emoji: '🧁', color: 'from-orange-50 to-yellow-100', time: 25, difficulty: '쉬움', servings: 6, kcal: 80, favorite: true,
    tags: ['밀프렙', '아침', '간식'],
    desc: '머핀틀 한 판으로 6개 구워 두고 아침·간식으로. (1개) 단백질 7g · 탄수 2g · 지방 5g',
    ingredients: [
      { name: '계란', amount: '6개' }, { name: '시금치', amount: '1줌' }, { name: '파프리카', amount: '1/2개' }, { name: '코티지치즈', amount: '60g' },
    ],
    steps: [
      '시금치와 파프리카를 잘게 다진다.',
      '계란을 풀고 코티지치즈와 채소를 섞은 뒤 소금, 후추로 간한다.',
      '실리콘 머핀틀 6칸에 나눠 붓는다.',
      '에어프라이어 170℃에서 15분 굽고 식혀 밀폐용기에 담는다. 냉장 4일 보관.',
    ],
  },
  {
    title: '곤약면 닭가슴살 팟타이', emoji: '🍜', color: 'from-rose-50 to-orange-100', time: 20, difficulty: '보통', servings: 1, kcal: 350,
    tags: ['면 당길 때', '저탄수'],
    desc: '면이 너무 먹고 싶은 날 곤약면으로. 단백질 38g · 탄수 18g · 지방 12g',
    ingredients: [
      { name: '곤약면', amount: '1봉' }, { name: '닭가슴살', amount: '100g' }, { name: '숙주', amount: '1줌' }, { name: '계란', amount: '1개' },
      { name: '저염 간장', amount: '1큰술' }, { name: '스리라차', amount: '1작은술' }, { name: '레몬', amount: '1/4개' },
    ],
    steps: [
      '곤약면은 찬물에 헹궈 끓는 물에 1분 데쳐 냄새를 뺀다.',
      '닭가슴살은 결대로 찢거나 얇게 썬다.',
      '팬에 계란을 스크램블한 뒤 닭가슴살, 곤약면을 넣고 볶는다.',
      '저염 간장, 스리라차, 알룰로스 약간으로 간하고 숙주를 넣어 30초만 볶는다.',
      '레몬즙을 짜서 마무리한다.',
    ],
  },
  {
    title: '고구마 코티지치즈 볼', emoji: '🍠', color: 'from-purple-100 to-amber-100', time: 25, difficulty: '쉬움', servings: 1, kcal: 330,
    tags: ['운동 전', '간식'],
    desc: '운동 1시간 전 에너지 충전용. 단백질 16g · 탄수 45g · 지방 9g',
    ingredients: [
      { name: '고구마', amount: '1개(150g)' }, { name: '코티지치즈', amount: '100g' }, { name: '아몬드', amount: '8알' }, { name: '알룰로스', amount: '1작은술' },
    ],
    steps: [
      '고구마를 씻어 에어프라이어 200℃에서 20분 굽는다.',
      '반으로 갈라 속을 살짝 으깬다.',
      '코티지치즈를 올리고 다진 아몬드, 알룰로스를 뿌린다.',
    ],
  },
];

// 레시피에서 모자란 재료 + 기한 지나 다시 사야 하는 것
const SEED_SHOPPING = [
  { name: '로메인 샐러드 믹스', done: false, from: '우둔살 스테이크 샐러드' },
  { name: '곤약면', done: false, from: '곤약면 닭가슴살 팟타이' },
  { name: '숙주', done: false, from: '곤약면 닭가슴살 팟타이' },
  { name: '구운 김', done: false, from: '연어 아보카도 포케' },
  { name: '무가당 두유', done: false, from: null },
  { name: '저당 쌈장', done: true, from: '참치 양배추 쌈' },
  { name: '통깨', done: true, from: '연어 아보카도 포케' },
];

// ── 테이블 생성 + seed ────────────────────────

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS ingredients (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    emoji      TEXT NOT NULL DEFAULT '🥕',
    category   TEXT NOT NULL DEFAULT '기타',
    qty        NUMERIC NOT NULL DEFAULT 1,
    unit       TEXT NOT NULL DEFAULT '개',
    storage    TEXT NOT NULL DEFAULT 'fridge' CHECK (storage IN ('fridge', 'freezer', 'pantry')),
    expiry     DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS recipes (
    id          SERIAL PRIMARY KEY,
    title       TEXT NOT NULL,
    emoji       TEXT NOT NULL,
    color       TEXT NOT NULL,
    time_min    INT NOT NULL,
    difficulty  TEXT NOT NULL,
    servings    INT NOT NULL,
    kcal        INT NOT NULL,
    description TEXT NOT NULL,
    tags        JSONB NOT NULL DEFAULT '[]',
    ingredients JSONB NOT NULL DEFAULT '[]',
    steps       JSONB NOT NULL DEFAULT '[]',
    favorite    BOOLEAN NOT NULL DEFAULT FALSE
  );
  -- AI 로 만든 레시피 구분용 (seed = 예시 데이터, ai = OpenAI 생성)
  ALTER TABLE recipes ADD COLUMN IF NOT EXISTS source     TEXT NOT NULL DEFAULT 'seed';
  ALTER TABLE recipes ADD COLUMN IF NOT EXISTS ai_request TEXT;
  ALTER TABLE recipes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS shopping_items (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    done        BOOLEAN NOT NULL DEFAULT FALSE,
    from_recipe TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

// 트랜잭션 안에서 예시 데이터를 넣는다. reset=true 면 기존 데이터를 지우고 다시 넣는다.
async function seed({ reset = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (reset) {
      await client.query('TRUNCATE ingredients, recipes, shopping_items RESTART IDENTITY');
    }

    const { rows } = await client.query('SELECT COUNT(*)::int AS n FROM recipes');
    if (rows[0].n === 0) {
      for (const i of SEED_INGREDIENTS) {
        await client.query(
          `INSERT INTO ingredients (name, emoji, category, qty, unit, storage, expiry)
           VALUES ($1, $2, $3, $4, $5, $6, ${TODAY_KST} + $7::int)`,
          [i.name, i.emoji, i.category, i.qty, i.unit, i.storage, i.days]
        );
      }
      for (const r of SEED_RECIPES) {
        await client.query(
          `INSERT INTO recipes (title, emoji, color, time_min, difficulty, servings, kcal, description, tags, ingredients, steps, favorite)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [r.title, r.emoji, r.color, r.time, r.difficulty, r.servings, r.kcal, r.desc,
           JSON.stringify(r.tags), JSON.stringify(r.ingredients), JSON.stringify(r.steps), !!r.favorite]
        );
      }
      for (const s of SEED_SHOPPING) {
        await client.query(
          'INSERT INTO shopping_items (name, done, from_recipe) VALUES ($1, $2, $3)',
          [s.name, s.done, s.from]
        );
      }
      console.log('✓ 예시 데이터를 넣었습니다.');
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── lazy init ────────────────────────────────
//
// cold start 마다 불릴 수 있으므로 한 번만 돌게 막는다.

let dbReady = null;

function initDB() {
  if (!dbReady) {
    dbReady = pool
      .query(SCHEMA_SQL)
      .then(() => seed())
      .catch((err) => {
        dbReady = null; // 실패하면 다음 요청에서 다시 시도
        throw err;
      });
  }
  return dbReady;
}

// ── 미들웨어 ─────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// /api 로 들어오는 요청은 테이블이 준비된 뒤에 처리한다
app.use('/api', async (_req, res, next) => {
  try {
    await initDB();
    next();
  } catch (err) {
    console.error('DB init 실패:', err);
    res.status(500).json({ success: false, message: '데이터베이스 초기화에 실패했습니다.' });
  }
});

// ════════════════════════════════════════════
// API: 회원가입 · 로그인 (JWT)
// ════════════════════════════════════════════
//
// 비밀번호는 bcrypt 해시로만 저장한다 (원문은 DB 에 남기지 않는다).
// 로그인에 성공하면 { token, user } 를 돌려주고,
// 프론트는 이후 요청마다 Authorization: Bearer <token> 헤더를 붙인다.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const toUser = (row) => ({ id: row.id, email: row.email, name: row.name });

const signToken = (user) => jwt.sign({ sub: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

const needSecret = (res) => {
  if (JWT_SECRET) return false;
  res.status(503).json({ success: false, message: 'JWT_SECRET 이 설정되지 않았습니다.' });
  return true;
};

// POST /api/auth/signup  { email, password, name }
app.post('/api/auth/signup', async (req, res, next) => {
  try {
    if (needSecret(res)) return;
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    const name = String(b.name || '').trim();
    const password = String(b.password || '');
    if (!EMAIL_RE.test(email)) return res.status(400).json({ success: false, message: '이메일 형식이 올바르지 않습니다.' });
    if (!name || name.length > 20) return res.status(400).json({ success: false, message: '이름은 1~20자로 입력해 주세요.' });
    if (password.length < 8 || password.length > 72) return res.status(400).json({ success: false, message: '비밀번호는 8~72자로 입력해 주세요.' });

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING RETURNING *`,
      [email, name, hash]
    );
    if (rows.length === 0) return res.status(409).json({ success: false, message: '이미 가입된 이메일입니다.' });
    const user = toUser(rows[0]);
    res.status(201).json({ success: true, data: { token: signToken(user), user } });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login  { email, password }
app.post('/api/auth/login', async (req, res, next) => {
  try {
    if (needSecret(res)) return;
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    // 이메일이 없는 경우와 비밀번호가 틀린 경우를 같은 메시지로 돌려준다 (가입 여부를 흘리지 않는다)
    const ok = rows.length > 0 && (await bcrypt.compare(password, rows[0].password_hash));
    if (!ok) return res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    const user = toUser(rows[0]);
    res.json({ success: true, data: { token: signToken(user), user } });
  } catch (err) {
    next(err);
  }
});

// 여기부터 아래의 /api 는 전부 로그인이 필요하다
app.use('/api', (req, res, next) => {
  if (needSecret(res)) return;
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email, name: payload.name };
    next();
  } catch {
    res.status(401).json({ success: false, message: '로그인이 만료되었습니다. 다시 로그인해 주세요.' });
  }
});

// GET /api/auth/me  →  토큰 주인 (새로고침 뒤 로그인 상태 확인용)
app.get('/api/auth/me', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (rows.length === 0) return res.status(401).json({ success: false, message: '계정을 찾을 수 없습니다. 다시 로그인해 주세요.' });
    res.json({ success: true, data: toUser(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// ── 응답 가공 (DB 컬럼 → 프론트가 쓰는 모양) ───
const toIngredient = (row) => ({
  id: row.id,
  name: row.name,
  emoji: row.emoji,
  category: row.category,
  qty: Number(row.qty),
  unit: row.unit,
  storage: row.storage,
  expiry: row.expiry,
});

const toRecipe = (row) => ({
  id: row.id,
  title: row.title,
  emoji: row.emoji,
  color: row.color,
  time: row.time_min,
  difficulty: row.difficulty,
  servings: row.servings,
  kcal: row.kcal,
  desc: row.description,
  tags: row.tags,
  ingredients: row.ingredients,
  steps: row.steps,
  favorite: row.favorite,
  source: row.source,
  aiRequest: row.ai_request,
});

const toShopping = (row) => ({
  id: row.id,
  name: row.name,
  done: row.done,
  from: row.from_recipe,
});

const parseId = (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ success: false, message: '잘못된 id 입니다.' });
    return null;
  }
  return id;
};

const STORAGE_KEYS = ['fridge', 'freezer', 'pantry'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ════════════════════════════════════════════
// API: 재료 (ingredients)
// ════════════════════════════════════════════

// GET /api/ingredients  →  유통기한 임박 순
app.get('/api/ingredients', async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM ingredients ORDER BY expiry ASC, id ASC');
    res.json({ success: true, data: rows.map(toIngredient) });
  } catch (err) {
    next(err);
  }
});

// POST /api/ingredients  { name, emoji, category, qty, unit, storage, expiry }
app.post('/api/ingredients', async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = (b.name || '').trim();
    const qty = Number(b.qty);
    if (!name) return res.status(400).json({ success: false, message: '재료 이름을 입력해 주세요.' });
    if (name.length > 50) return res.status(400).json({ success: false, message: '재료 이름은 50자까지 입력할 수 있습니다.' });
    if (!Number.isFinite(qty) || qty < 0) return res.status(400).json({ success: false, message: '수량이 올바르지 않습니다.' });
    if (!STORAGE_KEYS.includes(b.storage)) return res.status(400).json({ success: false, message: '보관 장소가 올바르지 않습니다.' });
    if (!DATE_RE.test(b.expiry || '')) return res.status(400).json({ success: false, message: '유통기한 날짜가 올바르지 않습니다.' });

    const { rows } = await pool.query(
      `INSERT INTO ingredients (name, emoji, category, qty, unit, storage, expiry)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [name, b.emoji || '🥕', b.category || '기타', qty, (b.unit || '개').trim(), b.storage, b.expiry]
    );
    res.status(201).json({ success: true, data: toIngredient(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/ingredients/:id
app.delete('/api/ingredients/:id', async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const { rows } = await pool.query('DELETE FROM ingredients WHERE id = $1 RETURNING *', [id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: '재료를 찾을 수 없습니다.' });
    res.json({ success: true, data: toIngredient(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// ════════════════════════════════════════════
// API: 레시피 (recipes)
// ════════════════════════════════════════════

// GET /api/recipes
app.get('/api/recipes', async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM recipes ORDER BY id ASC');
    res.json({ success: true, data: rows.map(toRecipe) });
  } catch (err) {
    next(err);
  }
});

// GET /api/recipes/:id
app.get('/api/recipes/:id', async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const { rows } = await pool.query('SELECT * FROM recipes WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: '레시피를 찾을 수 없습니다.' });
    res.json({ success: true, data: toRecipe(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/recipes/:id  { favorite }
app.patch('/api/recipes/:id', async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const { favorite } = req.body || {};
    if (typeof favorite !== 'boolean') return res.status(400).json({ success: false, message: 'favorite 는 true/false 여야 합니다.' });

    const { rows } = await pool.query('UPDATE recipes SET favorite = $1 WHERE id = $2 RETURNING *', [favorite, id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: '레시피를 찾을 수 없습니다.' });
    res.json({ success: true, data: toRecipe(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/recipes/:id  →  AI 가 만든 레시피만 지울 수 있다 (예시 레시피는 보호)
app.delete('/api/recipes/:id', async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const { rows } = await pool.query(`DELETE FROM recipes WHERE id = $1 AND source = 'ai' RETURNING *`, [id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: '지울 수 있는 AI 레시피가 없습니다.' });
    res.json({ success: true, data: toRecipe(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// ════════════════════════════════════════════
// API: AI 레시피 생성 (OpenAI)
// ════════════════════════════════════════════
//
// 냉장고 재료(유통기한 포함)를 DB 에서 읽어 OpenAI 에 넘기고,
// JSON 스키마로 고정된 레시피를 받아 recipes 테이블에 저장한다.

const RECIPE_COLORS = [
  'from-lime-100 to-emerald-100', 'from-indigo-100 to-violet-100', 'from-orange-100 to-rose-100',
  'from-yellow-100 to-lime-100', 'from-amber-100 to-orange-100', 'from-green-100 to-teal-100',
  'from-sky-100 to-indigo-100', 'from-yellow-100 to-amber-100', 'from-purple-100 to-amber-100',
  'from-pink-100 to-rose-100',
];

const AI_OPTIONS = {
  urgent: '유통기한이 3일 이내이거나 오늘까지인 재료를 최대한 많이 쓴다.',
  protein: '1회분 단백질 30g 이상.',
  lowcarb: '저탄수: 1회분 탄수화물 25g 이하.',
  quick: '조리 시간 15분 이내.',
  mealprep: '3~4일치를 한 번에 만들어 두는 밀프렙용.',
  noshop: '냉장고에 있는 재료만 쓴다 (장보기 없이).',
};
const AI_MEALS = ['아침', '점심', '저녁', '간식', '운동 전후'];

// OpenAI Structured Outputs 스키마 (strict: 모든 필드 필수)
const RECIPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'emoji', 'color', 'time', 'difficulty', 'servings', 'kcal', 'protein', 'carbs', 'fat', 'summary', 'tags', 'ingredients', 'steps'],
  properties: {
    title: { type: 'string', description: '요리 이름 (한국어, 자연스러운 띄어쓰기, 20자 이내. 예: 레몬 닭가슴살 두부 볶음)' },
    emoji: { type: 'string', description: '요리를 나타내는 이모지 1개' },
    color: { type: 'string', enum: RECIPE_COLORS, description: '카드 배경 그라디언트' },
    time: { type: 'integer', description: '총 조리 시간(분)' },
    difficulty: { type: 'string', enum: ['쉬움', '보통', '어려움'] },
    servings: { type: 'integer', description: '몇 인분(밀프렙이면 회분 수)' },
    kcal: { type: 'integer', description: '1회분 칼로리' },
    protein: { type: 'integer', description: '1회분 단백질(g)' },
    carbs: { type: 'integer', description: '1회분 탄수화물(g)' },
    fat: { type: 'integer', description: '1회분 지방(g)' },
    summary: { type: 'string', description: '한 줄 소개 (40자 이내, 탄단지 수치는 넣지 않는다)' },
    tags: { type: 'array', items: { type: 'string' }, description: '태그 2~3개 (예: 아침, 저탄수, 밀프렙)' },
    ingredients: {
      type: 'array',
      description: '재료 목록',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'amount'],
        properties: {
          name: { type: 'string', description: '냉장고에 있는 재료면 목록의 이름을 글자 그대로' },
          amount: { type: 'string', description: '분량 (예: 150g, 1/2개, 1큰술)' },
        },
      },
    },
    steps: { type: 'array', items: { type: 'string' }, description: '조리 순서 3~6단계, 불 세기·시간·온도까지 구체적으로' },
  },
};

async function callOpenAI(messages) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55_000);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        reasoning_effort: 'low',
        max_completion_tokens: 4000,
        response_format: { type: 'json_schema', json_schema: { name: 'recipe', strict: true, schema: RECIPE_SCHEMA } },
      }),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('OpenAI 오류:', res.status, json.error?.message);
      throw Object.assign(new Error('AI 호출에 실패했습니다.'), { status: 502 });
    }
    const msg = json.choices?.[0]?.message;
    if (msg?.refusal) throw Object.assign(new Error('AI 가 이 요청으로는 레시피를 만들 수 없다고 답했어요.'), { status: 422 });
    return JSON.parse(msg.content);
  } catch (err) {
    if (err.name === 'AbortError') throw Object.assign(new Error('AI 응답이 너무 오래 걸립니다. 다시 시도해 주세요.'), { status: 504 });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// POST /api/recipes/generate  { request?, meal?, options?: ['urgent', 'protein', ...] }
app.post('/api/recipes/generate', async (req, res, next) => {
  try {
    if (!OPENAI_API_KEY) return res.status(503).json({ success: false, message: 'OPENAI_API_KEY 가 설정되지 않았습니다.' });

    const b = req.body || {};
    const request = String(b.request || '').trim();
    const meal = AI_MEALS.includes(b.meal) ? b.meal : null;
    const options = (Array.isArray(b.options) ? b.options : []).filter((o) => AI_OPTIONS[o]);
    if (request.length > 300) return res.status(400).json({ success: false, message: '요청사항은 300자까지 입력할 수 있습니다.' });

    // 유통기한 지난 재료는 빼고, 남은 날짜와 함께 넘긴다
    const { rows: fridge } = await pool.query(
      `SELECT name, qty, unit, storage, (expiry - ${TODAY_KST}) AS days_left
         FROM ingredients WHERE expiry >= ${TODAY_KST} ORDER BY expiry ASC`
    );
    if (fridge.length === 0) return res.status(400).json({ success: false, message: '냉장고에 쓸 수 있는 재료가 없어요.' });

    const STORAGE_LABEL = { fridge: '냉장', freezer: '냉동', pantry: '실온' };
    const fridgeText = fridge
      .map((i) => `- ${i.name} (${Number(i.qty)}${i.unit}, ${STORAGE_LABEL[i.storage]}, ${i.days_left === 0 ? '오늘까지' : `${i.days_left}일 남음`})`)
      .join('\n');
    const { rows: existing } = await pool.query('SELECT title FROM recipes');

    const system = [
      '너는 식단 관리를 돕는 한국어 영양 코치 겸 요리사다.',
      '사용자는 고단백·저당 식단을 지키고 있어서 1회분 칼로리와 탄수화물·단백질·지방을 현실적인 수치로 계산해야 한다.',
      '냉장고에 있는 재료를 최대한 활용하고, 냉장고 재료를 쓸 때는 재료 이름을 목록에 적힌 그대로(띄어쓰기까지 똑같이) 쓴다.',
      '냉장고에 없는 재료는 소금·후추·물을 빼고 최대 2개까지만 추가한다.',
      '집에서 실제로 해 먹을 수 있는 요리만 만들고, 이미 있는 레시피와 겹치지 않게 한다.',
    ].join('\n');
    const user = [
      `## 냉장고 재료 (유통기한 임박 순)\n${fridgeText}`,
      `## 이미 있는 레시피 (겹치지 않게)\n${existing.map((r) => r.title).join(', ')}`,
      meal && `## 끼니\n${meal}`,
      options.length > 0 && `## 조건\n${options.map((o) => `- ${AI_OPTIONS[o]}`).join('\n')}`,
      request && `## 사용자 요청\n${request}`,
      '위 조건에 맞는 레시피 1개를 만들어 줘.',
    ].filter(Boolean).join('\n\n');

    const r = await callOpenAI([{ role: 'system', content: system }, { role: 'user', content: user }]);

    // AI 응답은 그대로 믿지 않고 범위를 한 번 더 정리한다
    const clampInt = (v, min, max) => Math.min(max, Math.max(min, Math.round(Number(v) || min)));
    const ingredients = (r.ingredients || [])
      .map((i) => ({ name: String(i.name || '').trim().slice(0, 50), amount: String(i.amount || '').trim().slice(0, 30) }))
      .filter((i) => i.name)
      .slice(0, 15);
    const steps = (r.steps || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 10);
    if (!r.title || ingredients.length === 0 || steps.length === 0) {
      return res.status(502).json({ success: false, message: 'AI 가 만든 레시피가 불완전해요. 다시 시도해 주세요.' });
    }
    const macros = `단백질 ${clampInt(r.protein, 0, 200)}g · 탄수 ${clampInt(r.carbs, 0, 300)}g · 지방 ${clampInt(r.fat, 0, 200)}g`;
    const tags = ['AI 추천', ...(r.tags || []).map((t) => String(t).trim()).filter(Boolean)].slice(0, 4);

    const { rows } = await pool.query(
      `INSERT INTO recipes (title, emoji, color, time_min, difficulty, servings, kcal, description, tags, ingredients, steps, source, ai_request)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'ai', $12) RETURNING *`,
      [
        String(r.title).trim().slice(0, 40),
        String(r.emoji || '🍽️').slice(0, 8),
        RECIPE_COLORS.includes(r.color) ? r.color : RECIPE_COLORS[0],
        clampInt(r.time, 1, 240),
        ['쉬움', '보통', '어려움'].includes(r.difficulty) ? r.difficulty : '보통',
        clampInt(r.servings, 1, 10),
        clampInt(r.kcal, 0, 3000),
        `${String(r.summary || '').trim().slice(0, 80)} ${macros}`.trim(),
        JSON.stringify(tags), JSON.stringify(ingredients), JSON.stringify(steps),
        [meal, ...options.map((o) => AI_OPTIONS[o]), request].filter(Boolean).join(' / ') || null,
      ]
    );
    res.status(201).json({ success: true, data: toRecipe(rows[0]) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    next(err);
  }
});

// ════════════════════════════════════════════
// API: 장보기 (shopping)
// ════════════════════════════════════════════

// GET /api/shopping  →  최근에 담은 것 먼저
app.get('/api/shopping', async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM shopping_items ORDER BY created_at DESC, id DESC');
    res.json({ success: true, data: rows.map(toShopping) });
  } catch (err) {
    next(err);
  }
});

// POST /api/shopping  { items: ['된장', ...], from? }  →  이미 있는 이름은 건너뛴다
app.post('/api/shopping', async (req, res, next) => {
  try {
    const { items, from } = req.body || {};
    const names = [...new Set((Array.isArray(items) ? items : []).map((n) => String(n).trim()).filter(Boolean))];
    if (names.length === 0) return res.status(400).json({ success: false, message: '담을 품목을 입력해 주세요.' });
    if (names.some((n) => n.length > 50)) return res.status(400).json({ success: false, message: '품목 이름은 50자까지 입력할 수 있습니다.' });

    const { rows } = await pool.query(
      `INSERT INTO shopping_items (name, from_recipe)
       SELECT UNNEST($1::text[]), $2
       ON CONFLICT (name) DO NOTHING
       RETURNING *`,
      [names, from || null]
    );
    res.status(201).json({ success: true, data: rows.map(toShopping) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/shopping/:id  { done }
app.patch('/api/shopping/:id', async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const { done } = req.body || {};
    if (typeof done !== 'boolean') return res.status(400).json({ success: false, message: 'done 은 true/false 여야 합니다.' });

    const { rows } = await pool.query('UPDATE shopping_items SET done = $1 WHERE id = $2 RETURNING *', [done, id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: '품목을 찾을 수 없습니다.' });
    res.json({ success: true, data: toShopping(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/shopping/completed  (/:id 보다 먼저 등록해야 가로채이지 않는다)
app.delete('/api/shopping/completed', async (_req, res, next) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM shopping_items WHERE done = TRUE');
    res.json({ success: true, data: { deleted: rowCount } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/shopping/:id
app.delete('/api/shopping/:id', async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const { rows } = await pool.query('DELETE FROM shopping_items WHERE id = $1 RETURNING *', [id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: '품목을 찾을 수 없습니다.' });
    res.json({ success: true, data: toShopping(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// ════════════════════════════════════════════
// API: 예시 데이터 초기화
// ════════════════════════════════════════════

// POST /api/reset  →  모든 데이터를 지우고 오늘 날짜 기준으로 예시 데이터를 다시 넣는다
app.post('/api/reset', async (_req, res, next) => {
  try {
    await seed({ reset: true });
    res.json({ success: true, data: { reset: true } });
  } catch (err) {
    next(err);
  }
});

// ── 없는 API 경로 ────────────────────────────
app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, message: '없는 API 경로입니다.' });
});

// ── SPA fallback (Express 5 문법) ─────────────
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── 에러 핸들러 ──────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ success: false, message: '서버에서 문제가 발생했습니다.' });
});

// ── 실행 / export ────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => console.log(`냉장고 파먹기 서버 실행 중 → http://localhost:${PORT}`));
}
module.exports = app;
