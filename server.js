const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 50 * 1024 * 1024 });

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const STORAGE_DIR = process.env.STORAGE_DIR || ROOT;
const DATA_DIR = process.env.DATA_DIR || path.join(STORAGE_DIR, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(STORAGE_DIR, 'uploads');
const PUBLIC_DIR = path.join(ROOT, 'public');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'service.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'agent')),
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cases (
    id TEXT PRIMARY KEY,
    citizen_name TEXT NOT NULL,
    national_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'open')) DEFAULT 'pending',
    assigned_user_id TEXT,
    created_at TEXT NOT NULL,
    approved_at TEXT,
    UNIQUE(citizen_name, national_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    sender_type TEXT NOT NULL CHECK(sender_type IN ('citizen', 'agent', 'admin', 'system')),
    sender_name TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(case_id) REFERENCES cases(id)
  );

  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('upload', 'recording')),
    created_at TEXT NOT NULL,
    FOREIGN KEY(case_id) REFERENCES cases(id)
  );
`);

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

const defaultAdminPassword = process.env.ADMIN_PASSWORD || 'admin123';
const defaultAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!defaultAdmin) {
  db.prepare(`
    INSERT INTO users (id, username, password_hash, role, display_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id(), 'admin', bcrypt.hashSync(defaultAdminPassword, 10), 'admin', '系統管理員', now());
}

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'replace-this-secret-before-production',
  resave: false,
  saveUninitialized: false,
  cookie: { sameSite: 'lax' }
});

app.use(express.json({ limit: '2mb' }));
app.use(sessionMiddleware);
app.use('/uploads', express.static(UPLOAD_DIR));

app.get(['/service', '/service/'], (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'service.html'));
});

app.use('/service', express.static(PUBLIC_DIR));

app.get('/', (_req, res) => {
  res.sendFile(path.join(ROOT, 'index.html'));
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.webm';
    cb(null, `${Date.now()}-${id()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('video/')) return cb(null, true);
    cb(new Error('只接受影片檔案'));
  }
});

function publicCase(row) {
  if (!row) return null;
  return {
    id: row.id,
    citizenName: row.citizen_name,
    status: row.status,
    assignedUserId: row.assigned_user_id,
    createdAt: row.created_at,
    approvedAt: row.approved_at
  };
}

function currentUser(req) {
  return req.session.user || null;
}

function requireStaff(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: '請先登入後台' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理員權限' });
  }
  next();
}

function requireCitizenCase(req, res, next) {
  if (!req.session.caseId) return res.status(401).json({ error: '請先以姓名與證號進入服務' });
  next();
}

function canAccessCase(req, caseId) {
  if (req.session.caseId === caseId) return true;
  return Boolean(req.session.user);
}

app.get('/api/me', (req, res) => {
  const caseRow = req.session.caseId
    ? db.prepare('SELECT * FROM cases WHERE id = ?').get(req.session.caseId)
    : null;
  res.json({ user: currentUser(req), case: publicCase(caseRow) });
});

app.post('/api/citizen/start', (req, res) => {
  const citizenName = String(req.body.citizenName || '').trim();
  const nationalId = String(req.body.nationalId || '').trim().toUpperCase();
  if (citizenName.length < 2 || nationalId.length < 6) {
    return res.status(400).json({ error: '請輸入姓名與身分證/居留證號' });
  }

  let caseRow = db.prepare('SELECT * FROM cases WHERE citizen_name = ? AND national_id = ?')
    .get(citizenName, nationalId);

  if (!caseRow) {
    const caseId = id();
    db.prepare(`
      INSERT INTO cases (id, citizen_name, national_id, status, created_at)
      VALUES (?, ?, ?, 'pending', ?)
    `).run(caseId, citizenName, nationalId, now());
    db.prepare(`
      INSERT INTO messages (id, case_id, sender_type, sender_name, body, created_at)
      VALUES (?, ?, 'system', '系統', ?, ?)
    `).run(id(), caseId, '民眾已送出線上客服開通申請，等待管理員審核。', now());
    caseRow = db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId);
  }

  if (caseRow.status !== 'open') {
    req.session.caseId = null;
    return res.json({ status: 'pending', case: publicCase(caseRow) });
  }

  req.session.caseId = caseRow.id;
  req.session.citizenName = citizenName;
  res.json({ status: 'open', case: publicCase(caseRow) });
});

app.post('/api/citizen/logout', (req, res) => {
  req.session.caseId = null;
  req.session.citizenName = null;
  res.json({ ok: true });
});

app.post('/api/staff/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '帳號或密碼錯誤' });
  }
  req.session.user = {
    id: user.id,
    username: user.username,
    role: user.role,
    displayName: user.display_name
  };
  res.json({ user: req.session.user });
});

app.post('/api/staff/logout', requireStaff, (req, res) => {
  req.session.user = null;
  res.json({ ok: true });
});

app.get('/api/cases', requireStaff, (req, res) => {
  const rows = db.prepare('SELECT * FROM cases ORDER BY created_at DESC').all();
  res.json({ cases: rows.map(publicCase) });
});

app.post('/api/cases/:caseId/approve', requireAdmin, (req, res) => {
  const target = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.caseId);
  if (!target) return res.status(404).json({ error: '找不到案件' });
  db.prepare(`
    UPDATE cases SET status = 'open', approved_at = COALESCE(approved_at, ?)
    WHERE id = ?
  `).run(now(), target.id);
  db.prepare(`
    INSERT INTO messages (id, case_id, sender_type, sender_name, body, created_at)
    VALUES (?, ?, 'system', '系統', ?, ?)
  `).run(id(), target.id, '管理員已開通線上客服服務。', now());
  const updated = db.prepare('SELECT * FROM cases WHERE id = ?').get(target.id);
  io.to(`case:${target.id}`).emit('case:updated', publicCase(updated));
  res.json({ case: publicCase(updated) });
});

app.get('/api/cases/:caseId/messages', (req, res) => {
  if (!canAccessCase(req, req.params.caseId)) return res.status(403).json({ error: '無權查看此案件' });
  const rows = db.prepare(`
    SELECT id, sender_type AS senderType, sender_name AS senderName, body, created_at AS createdAt
    FROM messages WHERE case_id = ? ORDER BY created_at ASC
  `).all(req.params.caseId);
  res.json({ messages: rows });
});

app.get('/api/cases/:caseId/files', (req, res) => {
  if (!canAccessCase(req, req.params.caseId)) return res.status(403).json({ error: '無權查看此案件' });
  const rows = db.prepare(`
    SELECT id, uploaded_by AS uploadedBy, original_name AS originalName, stored_name AS storedName,
      mime_type AS mimeType, size, kind, created_at AS createdAt
    FROM files WHERE case_id = ? ORDER BY created_at DESC
  `).all(req.params.caseId).map((file) => ({ ...file, url: `/uploads/${file.storedName}` }));
  res.json({ files: rows });
});

app.post('/api/cases/:caseId/files', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '請選擇影片檔案' });
  if (!canAccessCase(req, req.params.caseId)) return res.status(403).json({ error: '無權上傳此案件影片' });
  const caseRow = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.caseId);
  if (!caseRow || caseRow.status !== 'open') return res.status(400).json({ error: '案件尚未開通' });
  const uploader = req.session.user?.displayName || req.session.citizenName || '民眾';
  const kind = req.body.kind === 'recording' ? 'recording' : 'upload';
  const fileId = id();
  db.prepare(`
    INSERT INTO files (id, case_id, uploaded_by, original_name, stored_name, mime_type, size, kind, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(fileId, caseRow.id, uploader, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, kind, now());
  const saved = db.prepare(`
    SELECT id, uploaded_by AS uploadedBy, original_name AS originalName, stored_name AS storedName,
      mime_type AS mimeType, size, kind, created_at AS createdAt
    FROM files WHERE id = ?
  `).get(fileId);
  const payload = { ...saved, url: `/uploads/${saved.storedName}` };
  io.to(`case:${caseRow.id}`).emit('file:created', payload);
  res.json({ file: payload });
});

app.get('/api/users', requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT id, username, role, display_name AS displayName, created_at AS createdAt
    FROM users ORDER BY created_at DESC
  `).all();
  res.json({ users });
});

app.post('/api/users', requireAdmin, (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const displayName = String(req.body.displayName || '').trim();
  const role = req.body.role === 'admin' ? 'admin' : 'agent';
  if (username.length < 3 || password.length < 6 || displayName.length < 2) {
    return res.status(400).json({ error: '帳號至少 3 字、密碼至少 6 字，並需輸入姓名' });
  }
  try {
    const userId = id();
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, display_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, username, bcrypt.hashSync(password, 10), role, displayName, now());
    res.json({ ok: true });
  } catch (error) {
    res.status(409).json({ error: '帳號已存在' });
  }
});

io.use((socket, next) => sessionMiddleware(socket.request, {}, next));

io.on('connection', (socket) => {
  socket.on('case:join', (caseId) => {
    if (!canAccessCase(socket.request, caseId)) return;
    socket.join(`case:${caseId}`);
  });

  socket.on('message:create', ({ caseId, body }) => {
    if (!canAccessCase(socket.request, caseId)) return;
    const text = String(body || '').trim();
    if (!text) return;
    const sessionData = socket.request.session;
    const senderType = sessionData.user?.role === 'admin'
      ? 'admin'
      : sessionData.user
        ? 'agent'
        : 'citizen';
    const senderName = sessionData.user?.displayName || sessionData.citizenName || '民眾';
    const message = {
      id: id(),
      caseId,
      senderType,
      senderName,
      body: text,
      createdAt: now()
    };
    db.prepare(`
      INSERT INTO messages (id, case_id, sender_type, sender_name, body, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(message.id, caseId, senderType, senderName, text, message.createdAt);
    io.to(`case:${caseId}`).emit('message:created', message);
  });

  socket.on('call:join', (caseId) => {
    if (!canAccessCase(socket.request, caseId)) return;
    socket.join(`call:${caseId}`);
    socket.to(`call:${caseId}`).emit('call:peer-ready');
  });

  socket.on('call:signal', ({ caseId, signal }) => {
    if (!canAccessCase(socket.request, caseId)) return;
    socket.to(`call:${caseId}`).emit('call:signal', signal);
  });

  socket.on('call:leave', (caseId) => {
    socket.leave(`call:${caseId}`);
    socket.to(`call:${caseId}`).emit('call:peer-left');
  });
});

app.use((error, _req, res, _next) => {
  res.status(400).json({ error: error.message || '系統發生錯誤' });
});

server.listen(PORT, () => {
  console.log(`Public site running at http://localhost:${PORT}`);
  console.log(`Online report service running at http://localhost:${PORT}/service/`);
  console.log('Default admin: admin / ADMIN_PASSWORD or admin123');
});