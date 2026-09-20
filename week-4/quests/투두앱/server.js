// ── Module imports ───────────────────────────
const path = require('path');
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch {}

const express = require('express');
const { Pool } = require('pg');

// ── App init & config ────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;
const TITLE_MAX = 200;

// ── DB (Supabase PostgreSQL · transaction pooler) ──
// 6543 트랜잭션 풀러: 이름 붙은 prepared statement 는 쓰지 않는다 (일반 parameterized query 만).
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').trim(),
  ssl: { rejectUnauthorized: false },
  max: 3,
});
pool.on('error', (err) => console.error('pg pool error:', err.message));

let dbInitialized = false;
let dbInitPromise = null;
async function initDB() {
  if (dbInitialized) return;
  if (!dbInitPromise) {
    dbInitPromise = pool
      .query(`CREATE TABLE IF NOT EXISTS todos (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        done BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`)
      .then(() => { dbInitialized = true; })
      .catch((err) => {
        dbInitialized = false; // 실패 시 플래그 리셋 → 다음 요청에서 재시도
        dbInitPromise = null;
        throw err;
      });
  }
  await dbInitPromise;
}

const COLUMNS = 'id, title, done, created_at';

// ── Helpers ──────────────────────────────────
function parseId(raw) {
  if (!/^\d+$/.test(String(raw))) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

// 유효하면 { value }, 아니면 { error }
function validateTitle(title) {
  if (typeof title !== 'string') return { error: 'title is required' };
  const trimmed = title.trim();
  if (!trimmed) return { error: 'title is required' };
  if (trimmed.length > TITLE_MAX) return { error: `title must be ${TITLE_MAX} characters or less` };
  return { value: trimmed };
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

// ── API routes: todos ────────────────────────
// GET
app.get('/api/todos', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM todos ORDER BY created_at DESC, id DESC`
  );
  res.json({ success: true, data: rows });
});

// POST
app.post('/api/todos', async (req, res) => {
  const { title } = req.body || {};
  const t = validateTitle(title);
  if (t.error) return res.status(400).json({ success: false, message: t.error });

  const { rows } = await pool.query(
    `INSERT INTO todos (title) VALUES ($1) RETURNING ${COLUMNS}`,
    [t.value]
  );
  res.status(201).json({ success: true, data: rows[0] });
});

// PATCH
app.patch('/api/todos/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ success: false, message: 'Invalid id' });

  const body = req.body || {};
  const sets = [];
  const values = [];

  if (body.title !== undefined) {
    const t = validateTitle(body.title);
    if (t.error) return res.status(400).json({ success: false, message: t.error });
    values.push(t.value);
    sets.push(`title = $${values.length}`);
  }
  if (body.done !== undefined) {
    if (typeof body.done !== 'boolean') {
      return res.status(400).json({ success: false, message: 'done must be a boolean' });
    }
    values.push(body.done);
    sets.push(`done = $${values.length}`);
  }
  if (sets.length === 0) {
    return res.status(400).json({ success: false, message: 'Nothing to update (title or done required)' });
  }

  values.push(id);
  const { rows } = await pool.query(
    `UPDATE todos SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING ${COLUMNS}`,
    values
  );
  if (rows.length === 0) return res.status(404).json({ success: false, message: 'Todo not found' });
  res.json({ success: true, data: rows[0] });
});

// DELETE — /completed 를 /:id 보다 먼저 등록
app.delete('/api/todos/completed', async (_req, res) => {
  const { rowCount } = await pool.query('DELETE FROM todos WHERE done = TRUE');
  res.json({ success: true, data: { deleted: rowCount } });
});

app.delete('/api/todos/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ success: false, message: 'Invalid id' });

  const { rows } = await pool.query(
    `DELETE FROM todos WHERE id = $1 RETURNING ${COLUMNS}`,
    [id]
  );
  if (rows.length === 0) return res.status(404).json({ success: false, message: 'Todo not found' });
  res.json({ success: true, data: rows[0] });
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
