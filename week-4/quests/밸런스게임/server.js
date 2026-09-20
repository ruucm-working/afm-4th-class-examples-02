// ============================================
// 실시간 밸런스 게임 API 서버 (Express + PostgreSQL)
// ============================================
//
// 질문(A vs B)과 투표를 Supabase 의 PostgreSQL 에 저장한다.
// 한 사람(voterId)은 질문 하나에 한 표 — 다시 누르면 선택이 바뀐다.
// 화면은 몇 초마다 목록을 다시 불러와서 "실시간"으로 결과가 움직인다.
//
// 로컬 실행  : node server.js  →  http://localhost:6005
// Vercel 배포: module.exports = app 으로 서버리스 함수로 동작

// ── Module imports ───────────────────────────
const path = require('path');
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch {}

const express = require('express');
const { Pool } = require('pg');

// ── App init & config ────────────────────────
const app = express();
const PORT = process.env.PORT || 6005;
const OPTION_MAX = 60;

// ── DB (Supabase PostgreSQL · transaction pooler) ──
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').trim(),
  ssl: { rejectUnauthorized: false },
  max: 3,
});
pool.on('error', (err) => console.error('pg pool error:', err.message));

const SEED = [
  ['평생 여름만 살기', '평생 겨울만 살기'],
  ['짜장면 평생 금지', '짬뽕 평생 금지'],
  ['과거로 가서 10년 젊어지기', '미래로 가서 로또 번호 알아오기'],
  ['말하는 고양이 키우기', '하늘을 나는 강아지 키우기'],
];

let dbInitialized = false;
let dbInitPromise = null;
async function initDB() {
  if (dbInitialized) return;
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS balance_questions (
        id SERIAL PRIMARY KEY,
        option_a TEXT NOT NULL,
        option_b TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS balance_votes (
        id SERIAL PRIMARY KEY,
        question_id INTEGER NOT NULL REFERENCES balance_questions(id) ON DELETE CASCADE,
        voter_id TEXT NOT NULL,
        choice CHAR(1) NOT NULL CHECK (choice IN ('A', 'B')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (question_id, voter_id)
      )`);
      // 처음 한 번만 예시 질문을 넣는다
      const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM balance_questions');
      if (rows[0].n === 0) {
        for (const [a, b] of SEED) {
          await pool.query('INSERT INTO balance_questions (option_a, option_b) VALUES ($1, $2)', [a, b]);
        }
      }
      dbInitialized = true;
    })().catch((err) => {
      dbInitPromise = null; // 실패 시 리셋 → 다음 요청에서 재시도
      throw err;
    });
  }
  await dbInitPromise;
}

// 질문 + 표 수를 한 번에 가져오는 쿼리
const QUESTION_SELECT = `
  SELECT q.id, q.option_a, q.option_b, q.created_at,
         COUNT(v.id) FILTER (WHERE v.choice = 'A')::int AS votes_a,
         COUNT(v.id) FILTER (WHERE v.choice = 'B')::int AS votes_b
  FROM balance_questions q
  LEFT JOIN balance_votes v ON v.question_id = q.id`;

// ── Helpers ──────────────────────────────────
function parseId(raw) {
  if (!/^\d+$/.test(String(raw))) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

// 유효하면 { value }, 아니면 { error }
function validateOption(value, name) {
  if (typeof value !== 'string' || !value.trim()) return { error: `${name} is required` };
  const trimmed = value.trim();
  if (trimmed.length > OPTION_MAX) return { error: `${name} must be ${OPTION_MAX} characters or less` };
  return { value: trimmed };
}

function validVoterId(raw) {
  return typeof raw === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(raw) ? raw : null;
}

// ── Middleware ───────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname), { index: 'index.html' }));

app.use('/api', async (_req, res, next) => {
  try {
    await initDB();
    next();
  } catch (err) {
    console.error('DB init failed:', err.message);
    res.status(500).json({ success: false, message: 'Database initialization failed' });
  }
});

// ── API routes ───────────────────────────────
// GET 질문 목록 (?voterId= 를 주면 내가 고른 답도 같이)
app.get('/api/questions', async (req, res) => {
  const voterId = validVoterId(req.query.voterId);
  const { rows } = await pool.query(
    `${QUESTION_SELECT} GROUP BY q.id ORDER BY q.created_at DESC, q.id DESC`
  );
  let mine = {};
  if (voterId) {
    const r = await pool.query('SELECT question_id, choice FROM balance_votes WHERE voter_id = $1', [voterId]);
    mine = Object.fromEntries(r.rows.map((v) => [v.question_id, v.choice]));
  }
  res.json({ success: true, data: rows.map((q) => ({ ...q, my_choice: mine[q.id] || null })) });
});

// POST 새 질문
app.post('/api/questions', async (req, res) => {
  const { optionA, optionB } = req.body || {};
  const a = validateOption(optionA, 'optionA');
  if (a.error) return res.status(400).json({ success: false, message: a.error });
  const b = validateOption(optionB, 'optionB');
  if (b.error) return res.status(400).json({ success: false, message: b.error });
  if (a.value === b.value) return res.status(400).json({ success: false, message: 'optionA and optionB must differ' });

  const { rows } = await pool.query(
    'INSERT INTO balance_questions (option_a, option_b) VALUES ($1, $2) RETURNING id, option_a, option_b, created_at',
    [a.value, b.value]
  );
  res.status(201).json({ success: true, data: { ...rows[0], votes_a: 0, votes_b: 0, my_choice: null } });
});

// POST 투표 (같은 사람이 다시 누르면 선택 변경)
app.post('/api/questions/:id/vote', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ success: false, message: 'Invalid id' });
  const { choice, voterId } = req.body || {};
  if (choice !== 'A' && choice !== 'B') return res.status(400).json({ success: false, message: "choice must be 'A' or 'B'" });
  const voter = validVoterId(voterId);
  if (!voter) return res.status(400).json({ success: false, message: 'Invalid voterId' });

  const exists = await pool.query('SELECT 1 FROM balance_questions WHERE id = $1', [id]);
  if (exists.rowCount === 0) return res.status(404).json({ success: false, message: 'Question not found' });

  await pool.query(
    `INSERT INTO balance_votes (question_id, voter_id, choice) VALUES ($1, $2, $3)
     ON CONFLICT (question_id, voter_id) DO UPDATE SET choice = EXCLUDED.choice, created_at = NOW()`,
    [id, voter, choice]
  );
  const { rows } = await pool.query(`${QUESTION_SELECT} WHERE q.id = $1 GROUP BY q.id`, [id]);
  res.json({ success: true, data: { ...rows[0], my_choice: choice } });
});

// 정의되지 않은 API 경로
app.all('/api/{*splat}', (_req, res) => {
  res.status(404).json({ success: false, message: 'API route not found' });
});

// ── SPA fallback (Express 5 문법) ─────────────
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'), (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ success: false, message: 'Not found' });
    }
  });
});

// ── Error handler ────────────────────────────
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Invalid JSON body' });
  }
  console.error(err.message);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ── Startup & export ─────────────────────────
// Local: 서버 시작 / Vercel: app export
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}
module.exports = app;
