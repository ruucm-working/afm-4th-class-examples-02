// ============================================
// 포켓몬 도감 API 서버
// ============================================
//
// PokeAPI 대신 이 서버가 도감 데이터를 직접 제공한다.
// 데이터는 아래 POKEDEX 배열에 인메모리로 들고 있으며(우선 10마리),
// 클라이언트(index.html)가 바로 렌더링할 수 있는 형태로 가공해서 내려준다.

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── 미들웨어 ─────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── 표시용 라벨 ──────────────────────────────
const TYPE_LABELS = {
  normal: '노말', fire: '불꽃', water: '물', electric: '전기', grass: '풀',
  ice: '얼음', fighting: '격투', poison: '독', ground: '땅', flying: '비행',
  psychic: '에스퍼', bug: '벌레', rock: '바위', ghost: '고스트',
  dragon: '드래곤', dark: '악', steel: '강철', fairy: '페어리',
};

const STAT_LABELS = ['HP', '공격', '방어', '특수공격', '특수방어', '스피드'];

// 공식 아트워크 이미지 주소. 포켓몬마다 sprite 를 직접 지정하면 그 값이 우선한다.
const defaultSprite = (id) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;

// ── 인메모리 데이터: 포켓몬 10마리 ────────────
//
// 포켓몬을 추가하려면 이 배열에 같은 모양의 객체를 하나 더 넣으면 된다.
//   types : slug 은 index.html 의 TYPE_THEME 키와 일치해야 색이 입혀진다
//   stats : 6종(HP/공격/방어/특수공격/특수방어/스피드) 순서를 지킨다
//   height: 미터, weight: 킬로그램

let POKEDEX = [
  {
    id: 1, name: '풀씨몽', nameEn: 'Bulbasaur', genus: '씨앗포켓몬',
    generation: 1, isLegendary: false, isMythical: false,
    types: ['grass', 'poison'],
    height: 0.7, weight: 6.9,
    abilities: [{ name: '심록', isHidden: false }, { name: '엽록소', isHidden: true }],
    stats: [45, 49, 49, 65, 65, 45],
    description: '태어났을 때부터 등에 이상한 씨앗이 심어져 있으며 몸과 함께 씨앗도 자란다고 한다.',
  },
  {
    id: 4, name: '불꼬리', nameEn: 'Charmander', genus: '도마뱀포켓몬',
    generation: 1, isLegendary: false, isMythical: false,
    types: ['fire'],
    height: 0.6, weight: 8.5,
    abilities: [{ name: '맹화', isHidden: false }, { name: '태양의힘', isHidden: true }],
    stats: [39, 52, 43, 60, 50, 65],
    description: '태어났을 때부터 꼬리에 불꽃이 타오르고 있다. 불꽃이 꺼지면 목숨을 잃는다고 전해진다.',
  },
  {
    id: 7, name: '거품북', nameEn: 'Squirtle', genus: '꼬마거북포켓몬',
    generation: 1, isLegendary: false, isMythical: false,
    types: ['water'],
    height: 0.5, weight: 9.0,
    abilities: [{ name: '급류', isHidden: false }, { name: '쉘아머', isHidden: true }],
    stats: [44, 48, 65, 50, 64, 43],
    description: '등껍질에 숨어 몸을 지킨다. 반격할 때는 입에서 강한 물줄기를 뿜어낸다.',
  },
  {
    id: 25, name: '찌릿볼', nameEn: 'Pikachu', genus: '쥐포켓몬',
    generation: 1, isLegendary: false, isMythical: false,
    types: ['electric'],
    height: 0.4, weight: 6.0,
    abilities: [{ name: '정전기', isHidden: false }, { name: '피뢰침', isHidden: true }],
    stats: [35, 55, 40, 50, 50, 90],
    description: '볼에 있는 전기주머니에 전기를 모아둔다. 놀라거나 화가 나면 모아둔 전기를 방전한다.',
  },
  {
    id: 39, name: '몽실핑', nameEn: 'Jigglypuff', genus: '풍선포켓몬',
    generation: 1, isLegendary: false, isMythical: false,
    types: ['normal', 'fairy'],
    height: 0.5, weight: 5.5,
    abilities: [{ name: '하늘의은총', isHidden: false }, { name: '친구만들기', isHidden: true }],
    stats: [115, 45, 20, 45, 25, 20],
    description: '크고 둥근 눈을 흔들며 기분 좋은 자장가를 부른다. 상대가 잠들 때까지 절대 멈추지 않는다.',
  },
  {
    id: 52, name: '동전냥', nameEn: 'Meowth', genus: '고양이포켓몬',
    generation: 1, isLegendary: false, isMythical: false,
    types: ['normal'],
    height: 0.4, weight: 4.2,
    abilities: [{ name: '주움', isHidden: false }, { name: '근성', isHidden: true }],
    stats: [40, 45, 35, 40, 40, 90],
    description: '동전처럼 둥글고 반짝이는 물건을 아주 좋아한다. 밤이 되면 거리를 돌아다니며 주워 모은다.',
  },
  {
    id: 94, name: '그림령', nameEn: 'Gengar', genus: '그림자포켓몬',
    generation: 1, isLegendary: false, isMythical: false,
    types: ['ghost', 'poison'],
    height: 1.5, weight: 40.5,
    abilities: [{ name: '저주받은바디', isHidden: false }],
    stats: [60, 65, 60, 130, 75, 110],
    description: '어두운 곳에 숨어 그림자처럼 따라다닌다. 등 뒤에서 오싹한 한기를 느꼈다면 그림령의 소행이다.',
  },
  {
    id: 130, name: '폭포룡', nameEn: 'Gyarados', genus: '흉포포켓몬',
    generation: 1, isLegendary: false, isMythical: false,
    types: ['water', 'flying'],
    height: 6.5, weight: 235.0,
    abilities: [{ name: '위협', isHidden: false }, { name: '자기과신', isHidden: true }],
    stats: [95, 125, 79, 60, 100, 81],
    description: '한번 난동을 부리기 시작하면 주변이 모두 불타 없어질 때까지 멈추지 않는 난폭한 성격이다.',
  },
  {
    id: 143, name: '꿀잠보', nameEn: 'Snorlax', genus: '잠꾸러기포켓몬',
    generation: 1, isLegendary: false, isMythical: false,
    types: ['normal'],
    height: 2.1, weight: 460.0,
    abilities: [
      { name: '옹골참', isHidden: false },
      { name: '두꺼운지방', isHidden: false },
      { name: '위주머니', isHidden: true },
    ],
    stats: [160, 110, 65, 65, 110, 30],
    description: '하루에 400킬로그램의 음식을 먹어 치운다. 배가 부르면 그 자리에서 그대로 잠들어 버린다.',
  },
  {
    id: 150, name: '초능왕', nameEn: 'Mewtwo', genus: '유전포켓몬',
    generation: 1, isLegendary: true, isMythical: false,
    types: ['psychic'],
    height: 2.0, weight: 122.0,
    abilities: [{ name: '프레셔', isHidden: false }, { name: '불굴의마음', isHidden: true }],
    stats: [106, 110, 90, 154, 90, 130],
    description: '유전자 조작으로 만들어진 포켓몬. 인간의 과학으로 몸은 얻었지만 다정한 마음은 얻지 못했다.',
  },
];

// ── 응답 변환 ────────────────────────────────
// 클라이언트가 그대로 쓸 수 있도록 목록용/상세용 두 가지 모양으로 가공한다.

function toIndexItem(p) {
  return {
    id: p.id,
    name: p.name,
    nameEn: p.nameEn,
    genus: p.genus,
    generation: p.generation,
    isLegendary: p.isLegendary,
    isMythical: p.isMythical,
    sprite: p.sprite || defaultSprite(p.id),
    types: p.types.map((slug) => ({ slug, label: TYPE_LABELS[slug] || slug })),
  };
}

function toDetail(p) {
  return {
    id: p.id,
    height: p.height.toFixed(1),
    weight: p.weight.toFixed(1),
    description: p.description,
    descriptionIsEnglish: false,
    abilities: p.abilities,
    stats: p.stats.map((value, i) => ({ label: STAT_LABELS[i] || `스탯${i + 1}`, value })),
  };
}

// ── API 라우트 ───────────────────────────────

// 도감 목록 (카드 그리드용)
app.get('/api/pokemon', (_req, res) => {
  const list = [...POKEDEX].sort((a, b) => a.id - b.id).map(toIndexItem);
  res.json({ success: true, data: list });
});

// 개별 포켓몬 상세 (카드를 열 때 지연 로딩)
app.get('/api/pokemon/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ success: false, message: '도감 번호는 숫자여야 합니다.' });
  }

  const found = POKEDEX.find((p) => p.id === id);
  if (!found) {
    return res.status(404).json({ success: false, message: `${id}번 포켓몬을 찾을 수 없습니다.` });
  }

  res.json({ success: true, data: toDetail(found) });
});

// ── SPA fallback (Express 5 문법) ─────────────
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── 에러 핸들러 ──────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ success: false, message: '서버 내부 오류가 발생했습니다.' });
});

// 로컬: 서버 시작 / Vercel: app export
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`포켓몬 도감 서버 실행 중 → http://localhost:${PORT}`);
    console.log(`등록된 포켓몬 ${POKEDEX.length}마리`);
  });
}

module.exports = app;
