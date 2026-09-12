// ============================================
// 투두앱 API 서버 (Express + PostgreSQL)
// ============================================
//
// 할 일 데이터를 Supabase 의 PostgreSQL 에 저장한다.
// 서버를 껐다 켜도 데이터가 남는다는 점이 인메모리 예제와 다른 점.
//
// 로컬 실행  : node server.js  →  http://localhost:6003
// Vercel 배포: module.exports = app 으로 서버리스 함수로 동작

const express = require('express');
const path = require('path');
const { Pool } = require('pg');

// ── .env 로드 (Node 20.12+ 내장, 없으면 조용히 넘어간다) ──────
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // .env 가 없으면 실제 환경변수(Vercel 설정 등)를 그대로 사용한다
}

const app = express();
const PORT = process.env.PORT || 6003;

// ── DB 연결 ──────────────────────────────────
//
// 접속 정보는 코드에 절대 박지 않는다. .env 의 DATABASE_URL 에서만 읽는다.
// (.env 는 .gitignore 에 들어 있어 커밋되지 않는다. .env.example 참고)
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

// ── 테이블 준비 (lazy init) ───────────────────
//
// cold start 마다 불릴 수 있으므로 플래그로 한 번만 돌게 막는다.

let dbReady = null;

function initDB() {
  if (!dbReady) {
    dbReady = pool
      .query(`
        CREATE TABLE IF NOT EXISTS todos (
          id         SERIAL PRIMARY KEY,
          title      TEXT NOT NULL,
          done       BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `)
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

// ── 응답 가공 ────────────────────────────────
const toTodo = (row) => ({
  id: row.id,
  title: row.title,
  done: row.done,
  createdAt: row.created_at,
});

// ── API: 목록 조회 ───────────────────────────
// GET /api/todos  →  미완료 먼저, 그다음 최신순
app.get('/api/todos', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM todos ORDER BY done ASC, created_at DESC'
    );
    res.json({ success: true, data: rows.map(toTodo) });
  } catch (err) {
    next(err);
  }
});

// ── API: 할 일 추가 ──────────────────────────
// POST /api/todos  { title }
app.post('/api/todos', async (req, res, next) => {
  try {
    const title = (req.body?.title || '').trim();
    if (!title) {
      return res.status(400).json({ success: false, message: '할 일 내용을 입력해 주세요.' });
    }
    if (title.length > 200) {
      return res.status(400).json({ success: false, message: '할 일은 200자까지 입력할 수 있습니다.' });
    }

    const { rows } = await pool.query(
      'INSERT INTO todos (title) VALUES ($1) RETURNING *',
      [title]
    );
    res.status(201).json({ success: true, data: toTodo(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// ── API: 완료 토글 / 내용 수정 ────────────────
// PATCH /api/todos/:id  { done?, title? }
app.patch('/api/todos/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: '잘못된 id 입니다.' });
    }

    const { done, title } = req.body || {};
    const fields = [];
    const values = [];

    if (typeof done === 'boolean') {
      values.push(done);
      fields.push(`done = $${values.length}`);
    }
    if (typeof title === 'string') {
      const trimmed = title.trim();
      if (!trimmed) {
        return res.status(400).json({ success: false, message: '할 일 내용은 비울 수 없습니다.' });
      }
      values.push(trimmed);
      fields.push(`title = $${values.length}`);
    }
    if (fields.length === 0) {
      return res.status(400).json({ success: false, message: '수정할 내용이 없습니다.' });
    }

    values.push(id);
    const { rows } = await pool.query(
      `UPDATE todos SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '할 일을 찾을 수 없습니다.' });
    }
    res.json({ success: true, data: toTodo(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// ── API: 완료된 할 일 일괄 삭제 ───────────────
// DELETE /api/todos/completed
app.delete('/api/todos/completed', async (_req, res, next) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM todos WHERE done = TRUE');
    res.json({ success: true, data: { deleted: rowCount } });
  } catch (err) {
    next(err);
  }
});

// ── API: 삭제 ────────────────────────────────
// DELETE /api/todos/:id
app.delete('/api/todos/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: '잘못된 id 입니다.' });
    }

    const { rows } = await pool.query('DELETE FROM todos WHERE id = $1 RETURNING *', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '할 일을 찾을 수 없습니다.' });
    }
    res.json({ success: true, data: toTodo(rows[0]) });
  } catch (err) {
    next(err);
  }
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
  app.listen(PORT, () => console.log(`투두앱 서버 실행 중 → http://localhost:${PORT}`));
}
module.exports = app;
