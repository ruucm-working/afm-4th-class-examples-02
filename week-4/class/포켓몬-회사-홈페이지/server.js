// ============================================
// 포켓몬 컴퍼니 홈페이지 서버
// ============================================
//
// 하는 일은 두 가지뿐이다.
//   1. index.html(단일 파일 React 앱) 정적 서빙
//   2. 하단 문의폼에서 넘어온 내용을 PostgreSQL(Supabase)에 저장
//
// 예전에는 문의내역.txt 파일에 쌓았지만, 이제 contacts 테이블에 한 행씩 INSERT 한다.
// 접속 정보는 코드에 박지 않고 .env 의 DATABASE_URL 에서 읽는다.

require('dotenv').config();

const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// ── 미들웨어 ─────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── DB 연결 풀 ───────────────────────────────
// Vercel 등에서 환경변수 끝에 줄바꿈이 붙는 경우가 있어 항상 .trim() 한다.
const connectionString = (process.env.DATABASE_URL || '').trim();

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }, // Supabase 는 SSL 필수
  max: 5,
});

pool.on('error', (err) => console.error('DB 풀 오류:', err.message));

// ── 테이블 lazy init ─────────────────────────
// 서버리스에서는 cold start 마다 호출될 수 있으므로 flag 로 중복 실행을 막는다.
let dbInitialized = false;

async function initDB() {
  if (dbInitialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contacts (
      id         SERIAL PRIMARY KEY,
      name       TEXT        NOT NULL,
      email      TEXT        NOT NULL,
      category   TEXT        NOT NULL DEFAULT '기타',
      message    TEXT        NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  dbInitialized = true;
}

// /api 로 들어오는 모든 요청 전에 테이블을 준비시킨다.
app.use('/api', async (_req, res, next) => {
  try {
    await initDB();
    next();
  } catch (err) {
    console.error('DB 초기화 실패:', err.message);
    res.status(500).json({ success: false, message: '데이터베이스 초기화에 실패했습니다.' });
  }
});

// 화면에 보여줄 시각 문자열 (한국 시간)
const toKST = (date) => new Date(date).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

// ── API: 문의 접수 ───────────────────────────
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, category, message } = req.body || {};

    // 필수값 검증
    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        message: '이름, 이메일, 문의 내용은 필수입니다.',
      });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: '이메일 형식이 올바르지 않습니다.',
      });
    }

    // 값은 반드시 파라미터로 넘긴다 (문자열 이어붙이기 = SQL 인젝션)
    const { rows } = await pool.query(
      `INSERT INTO contacts (name, email, category, message)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      [
        String(name).trim(),
        String(email).trim(),
        String(category || '기타').trim(),
        String(message).trim(),
      ]
    );

    res.status(201).json({
      success: true,
      data: { id: rows[0].id, createdAt: toKST(rows[0].created_at) },
      message: '문의가 정상적으로 접수되었습니다.',
    });
  } catch (err) {
    console.error('문의 저장 실패:', err.message);
    res.status(500).json({ success: false, message: '문의를 저장하지 못했습니다.' });
  }
});

// ── API: 접수된 문의 건수 ────────────────────
app.get('/api/contact/count', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM contacts');
    res.json({ success: true, data: { count: rows[0].count } });
  } catch (err) {
    console.error('문의 건수 조회 실패:', err.message);
    res.status(500).json({ success: false, message: '문의 건수를 불러오지 못했습니다.' });
  }
});

// ── API: 문의 목록 (최신순, 관리자 확인용) ───
app.get('/api/contact', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, category, message, created_at
       FROM contacts
       ORDER BY id DESC
       LIMIT 100`
    );
    res.json({
      success: true,
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        category: row.category,
        message: row.message,
        createdAt: toKST(row.created_at),
      })),
    });
  } catch (err) {
    console.error('문의 목록 조회 실패:', err.message);
    res.status(500).json({ success: false, message: '문의 목록을 불러오지 못했습니다.' });
  }
});

// ── SPA fallback (Express 5 문법) ────────────
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
  if (!connectionString) {
    console.error('DATABASE_URL 이 없습니다. .env 파일을 확인하세요.');
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`포켓몬 컴퍼니 홈페이지 → http://localhost:${PORT}`);
    console.log(`문의 저장소 → PostgreSQL (contacts 테이블)`);
  });
}
module.exports = app;
