// ============================================================
// LEICA LAB — 라이카 감성 사진 생성기 백엔드
// fal.ai FLUX 호출을 서버에서 대신하고, API 키는 환경변수로만 읽는다.
// 로컬: node server.js  /  Vercel: module.exports = app
// ============================================================

const express = require('express');
const path = require('path');

// ── .env 로드 (Node 20.12+ 내장, 없으면 조용히 넘어간다) ──────
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // .env 파일이 없으면 실제 환경변수(PaaS 설정 등)를 그대로 사용한다
}

const app = express();
const PORT = process.env.PORT || 3000;

// 키는 코드에 절대 하드코딩하지 않는다. 환경변수에서만 읽는다.
// (Vercel 등에서 값 끝에 개행이 붙는 경우가 있어 trim)
const FAL_KEY = (process.env.FAL_KEY || '').trim();
const FAL_BASE_URL = 'https://fal.run/';
const REQUEST_TIMEOUT_MS = Number(process.env.FAL_TIMEOUT_MS || 120000);

// ── 프리셋 데이터 (프롬프트 조립 재료) ────────────────────────

const MODELS = [
  { id: 'fal-ai/flux/dev', label: 'Flux Dev', desc: '고품질 · 느림 (약 10~20초)', steps: 28, guidance: 3.5 },
  { id: 'fal-ai/flux/schnell', label: 'Flux Schnell', desc: '빠름 · 가벼움 (약 2~4초)', steps: 4, guidance: null },
];

const RATIOS = [
  { id: '3:2', label: '3:2 가로', sub: '라이카 기본', width: 1440, height: 960 },
  { id: '2:3', label: '2:3 세로', sub: '인물', width: 960, height: 1440 },
  { id: '1:1', label: '1:1 정방', sub: 'SNS', width: 1152, height: 1152 },
  { id: '16:9', label: '16:9 와이드', sub: '시네마틱', width: 1440, height: 810 },
];

// 라이카 대표 M 마운트 렌즈의 묘사 특성을 프롬프트로 번역한다
const LENSES = [
  { id: 'summicron35', label: '35mm Summicron f/2', sub: '스트리트 표준',
    prompt: 'shot on a Leica M camera with a 35mm Summicron f/2 ASPH lens at f/2.8, natural perspective, crisp micro-contrast, subtle corner vignetting' },
  { id: 'summilux50', label: '50mm Summilux f/1.4', sub: '인물·보케',
    prompt: 'shot on a Leica M camera with a 50mm Summilux f/1.4 ASPH wide open, creamy rounded bokeh, silky out-of-focus falloff, three-dimensional subject separation' },
  { id: 'noctilux50', label: '50mm Noctilux f/0.95', sub: '극단적 얕은 심도',
    prompt: 'shot on a Leica M camera with a 50mm Noctilux f/0.95 wide open, razor-thin plane of focus, swirling dreamy bokeh, glowing highlight bloom' },
  { id: 'elmarit28', label: '28mm Elmarit f/2.8', sub: '현장감·환경',
    prompt: 'shot on a Leica M camera with a 28mm Elmarit f/2.8, wide environmental framing, deep context, rectilinear geometry without distortion' },
  { id: 'apo90', label: '90mm APO-Summicron f/2', sub: '압축된 망원',
    prompt: 'shot on a Leica M camera with a 90mm APO-Summicron f/2, compressed telephoto perspective, clinically sharp subject against a soft background' },
  { id: 'q3_28', label: 'Leica Q3 28mm', sub: '스냅·데일리',
    prompt: 'shot on a Leica Q3 with its fixed 28mm Summilux f/1.7 lens, effortless everyday snapshot framing, high resolution detail' },
];

// 필름 컬러 사이언스
const FILMS = [
  { id: 'portra400', label: 'Kodak Portra 400', sub: '따뜻한 피부톤',
    prompt: 'Kodak Portra 400 color science, warm neutral skin tones, soft pastel highlights, low saturation, fine organic grain' },
  { id: 'trix400', label: 'Kodak Tri-X 400', sub: '흑백 다큐',
    prompt: 'black and white photograph on Kodak Tri-X 400, rich deep blacks, luminous highlights, pronounced silver halide grain, classic photojournalism tonality' },
  { id: 'ektar100', label: 'Kodak Ektar 100', sub: '선명한 채도',
    prompt: 'Kodak Ektar 100 color science, vivid saturated colors, ultra-fine grain, punchy contrast, crisp clean reds' },
  { id: 'cinestill800t', label: 'CineStill 800T', sub: '야간 텅스텐',
    prompt: 'CineStill 800T tungsten film, cool cyan shadows, red halation glow around bright lights, cinematic night palette, visible grain' },
  { id: 'fuji400h', label: 'Fujifilm Pro 400H', sub: '민트빛 파스텔',
    prompt: 'Fujifilm Pro 400H color science, airy pastel palette, minty green shadows, gentle highlight rolloff, delicate grain' },
  { id: 'digital', label: 'Leica Digital', sub: '모던 디지털',
    prompt: 'modern Leica digital color rendering, true-to-life colors, clean shadows, natural dynamic range, no film grain' },
];

const LIGHTS = [
  { id: 'golden', label: '골든아워', prompt: 'golden hour sunlight, long warm rake light, glowing rim highlights' },
  { id: 'overcast', label: '흐린 날', prompt: 'soft overcast diffused daylight, even gentle shadows, muted palette' },
  { id: 'window', label: '창가 자연광', prompt: 'soft directional window light indoors, gradual falloff into shadow' },
  { id: 'neon', label: '야간 네온', prompt: 'night scene lit by neon signage and shop windows, wet reflective pavement, deep shadows' },
  { id: 'harsh', label: '한낮 강한 빛', prompt: 'harsh midday sun, hard-edged shadows, high contrast, bright specular highlights' },
  { id: 'bluehour', label: '블루아워', prompt: 'blue hour twilight, deep indigo sky, warm artificial lights beginning to glow' },
];

const MOODS = [
  { id: 'street', label: '스트리트 스냅', prompt: 'candid street photography, decisive moment, unposed authentic gesture, documentary framing' },
  { id: 'portrait', label: '환경 인물', prompt: 'intimate environmental portrait, natural expression, quiet presence' },
  { id: 'travel', label: '여행 기록', prompt: 'travel reportage, strong sense of place, layered background storytelling' },
  { id: 'still', label: '정물·디테일', prompt: 'quiet still life detail, minimal composition, tactile surface texture' },
  { id: 'landscape', label: '풍경', prompt: 'wide landscape scene, atmospheric depth, layered horizon' },
  { id: 'nostalgia', label: '노스탤지어', prompt: 'nostalgic melancholic mood, faded memory atmosphere, contemplative stillness' },
];

// 모든 프롬프트 끝에 붙는 라이카 룩 베이스
const LEICA_BASE = 'Leica look: exceptional micro-contrast, organic three-dimensional rendering, natural color rendition, smooth tonal gradation, no digital over-sharpening, no HDR, no plastic skin, photorealistic, professional photography';

const IDEA_SEEDS = [
  '비 온 뒤 서울 을지로 골목, 우산을 접는 노인',
  '창가에 앉아 커피잔을 든 여자, 김이 피어오른다',
  '교토의 좁은 골목을 걷는 학생들의 뒷모습',
  '아침 시장에서 생선을 다듬는 상인의 손',
  '지하철 창문에 비친 승객들의 실루엣',
  '낡은 자전거가 기대어 선 파란 페인트 벽',
  '해질 무렵 한강 둔치에서 뛰노는 아이들',
  '오래된 레코드 가게 주인과 턴테이블',
  '눈 내리는 밤 포장마차의 노란 불빛',
  '빨래가 널린 부산 산복도로의 좁은 계단',
  '카페 테이블 위 반쯤 남은 와인잔과 책',
  '안개 낀 새벽 시골길을 걷는 우비 입은 사람',
];

// ── 인메모리 상태: 생성 로그 + 간단한 호출 제한 ───────────────
// 공용 API 키를 쓰므로 폭주 호출을 막는 최소한의 가드만 둔다.
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 40);
const rateBuckets = new Map(); // ip -> number[] (요청 타임스탬프)

let generationLog = []; // 최근 생성 기록 (서버 재시작 시 초기화)
let nextLogId = 1;

// ── Middleware ───────────────────────────────────────────────
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname)));

// ── Helpers ──────────────────────────────────────────────────

function pick(list, id) {
  return list.find((item) => item.id === id);
}

// 클라이언트의 프리뷰와 동일한 규칙으로 최종 프롬프트를 조립한다.
function composePrompt({ scene, lens, film, light, mood }) {
  return [
    scene.trim(),
    pick(MOODS, mood)?.prompt,
    pick(LIGHTS, light)?.prompt,
    pick(LENSES, lens)?.prompt,
    pick(FILMS, film)?.prompt,
    LEICA_BASE,
  ].filter(Boolean).join(', ');
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const hits = (rateBuckets.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (hits.length >= RATE_LIMIT_MAX) return false;
  hits.push(now);
  rateBuckets.set(ip, hits);
  return true;
}

// fal.ai 호출 — 실패 시 키가 노출되지 않는 형태의 메시지만 던진다.
async function callFal({ model, body }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(FAL_BASE_URL + model, {
      method: 'POST',
      headers: {
        Authorization: `Key ${FAL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch { /* 비 JSON 응답 */ }

    if (!res.ok) {
      const detail = payload?.detail?.[0]?.msg || payload?.detail || payload?.message || '';
      const err = new Error(typeof detail === 'string' && detail ? detail : `fal.ai 요청 실패 (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return payload;
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeout = new Error('이미지 생성이 시간 내에 끝나지 않았습니다. 장수를 줄이거나 Schnell 모델로 다시 시도해 주세요.');
      timeout.status = 504;
      throw timeout;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── API routes ───────────────────────────────────────────────

// 서버 상태 · 키 설정 여부 (키 값 자체는 절대 내려보내지 않는다)
app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      keyConfigured: FAL_KEY.length > 0,
      generatedCount: generationLog.length,
    },
  });
});

// 프롬프트 재료 일체 — 클라이언트는 이 데이터로 UI를 그린다
app.get('/api/presets', (_req, res) => {
  res.json({
    success: true,
    data: { models: MODELS, ratios: RATIOS, lenses: LENSES, films: FILMS, lights: LIGHTS, moods: MOODS, ideas: IDEA_SEEDS },
  });
});

// 최근 생성 기록 (인메모리)
app.get('/api/history', (_req, res) => {
  res.json({ success: true, data: generationLog.slice(0, 36) });
});

// 핵심: 이미지 생성 프록시
app.post('/api/generate', async (req, res, next) => {
  try {
    if (!FAL_KEY) {
      return res.status(500).json({
        success: false,
        message: 'FAL_KEY 환경변수가 설정되지 않았습니다. .env.example 을 참고해 .env 를 만들어 주세요.',
      });
    }

    if (!checkRateLimit(clientIp(req))) {
      return res.status(429).json({ success: false, message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
    }

    const { scene, lens, film, light, mood, ratio, model, count, seed } = req.body || {};

    // ── 검증: 모든 선택값은 서버가 아는 프리셋이어야 한다 ──
    if (typeof scene !== 'string' || !scene.trim()) {
      return res.status(400).json({ success: false, message: '장면 묘사(scene)를 입력해 주세요.' });
    }
    if (scene.trim().length > 400) {
      return res.status(400).json({ success: false, message: '장면 묘사는 400자 이하로 입력해 주세요.' });
    }

    const modelCfg = pick(MODELS, model);
    const ratioCfg = pick(RATIOS, ratio);
    if (!modelCfg) return res.status(400).json({ success: false, message: '지원하지 않는 모델입니다.' });
    if (!ratioCfg) return res.status(400).json({ success: false, message: '지원하지 않는 화면 비율입니다.' });
    if (!pick(LENSES, lens)) return res.status(400).json({ success: false, message: '지원하지 않는 렌즈입니다.' });
    if (!pick(FILMS, film)) return res.status(400).json({ success: false, message: '지원하지 않는 필름입니다.' });
    if (!pick(LIGHTS, light)) return res.status(400).json({ success: false, message: '지원하지 않는 조명입니다.' });
    if (!pick(MOODS, mood)) return res.status(400).json({ success: false, message: '지원하지 않는 무드입니다.' });

    const numImages = Math.min(Math.max(Number(count) || 1, 1), 4);

    const prompt = composePrompt({ scene, lens, film, light, mood });

    const body = {
      prompt,
      image_size: { width: ratioCfg.width, height: ratioCfg.height },
      num_images: numImages,
      num_inference_steps: modelCfg.steps,
      enable_safety_checker: true,
    };
    if (modelCfg.guidance !== null) body.guidance_scale = modelCfg.guidance;
    if (seed !== undefined && seed !== null && String(seed).trim() !== '' && Number.isFinite(Number(seed))) {
      body.seed = Number(seed);
    }

    const result = await callFal({ model: modelCfg.id, body });

    if (!Array.isArray(result?.images) || result.images.length === 0) {
      return res.status(502).json({ success: false, message: '이미지가 반환되지 않았습니다. 프롬프트를 바꿔 다시 시도해 주세요.' });
    }

    const settings = { lens, film, light, mood, ratio, model };
    const labels = {
      lensLabel: pick(LENSES, lens).label,
      filmLabel: pick(FILMS, film).label,
      lightLabel: pick(LIGHTS, light).label,
      moodLabel: pick(MOODS, mood).label,
      modelLabel: modelCfg.label,
    };

    const shots = result.images.map((img) => ({
      id: nextLogId++,
      url: img.url,
      width: img.width,
      height: img.height,
      prompt,
      scene: scene.trim(),
      seed: result.seed ?? null,
      createdAt: new Date().toISOString(),
      settings,
      ...labels,
    }));

    generationLog = [...shots, ...generationLog].slice(0, 120);

    res.json({ success: true, data: { shots, prompt, seed: result.seed ?? null } });
  } catch (err) {
    next(err);
  }
});

// ── SPA fallback (Express 5 문법) ─────────────────────────────
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Error handler ────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[leica-lab]', err.message);
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  const message = status === 401 || status === 403
    ? 'fal.ai 인증에 실패했습니다. 서버의 FAL_KEY 환경변수를 확인해 주세요.'
    : err.message || '서버 내부 오류가 발생했습니다.';
  res.status(status).json({ success: false, message });
});

// ── Startup & export ─────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`LEICA LAB → http://localhost:${PORT}`);
    if (!FAL_KEY) {
      console.warn('⚠️  FAL_KEY 가 비어 있습니다. .env.example 을 복사해 .env 를 만들고 키를 넣어 주세요.');
    }
  });
}

module.exports = app;
