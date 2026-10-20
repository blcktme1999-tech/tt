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
const { RtcRole, RtcTokenBuilder } = require('agora-token');
const { appendPriorityMessage, priorityEntriesFromInput, publicPriorityApplication } = require('./api/_lib/service');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 50 * 1024 * 1024 });

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const AGENCY_DIR = path.join(ROOT, 'agency-introduction-pages');
const ANNOUNCEMENTS_DIR = path.join(ROOT, 'announcements');
const WANTED_DIR = path.join(ROOT, 'wanted');
const FORENSICS_DIR = path.join(ROOT, 'forensics');
const PUBLIC_INFO_DIR = path.join(ROOT, 'public-info');
const PUBLIC_SERVICES_DIR = path.join(ROOT, 'public-services');
const SITEMAP_DIR = path.join(ROOT, 'sitemap');
const RELATED_LINKS_DIR = path.join(ROOT, 'related-links');
const AGORA_APP_ID = process.env.AGORA_APP_ID || '';
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || '';
const AGORA_TOKEN_TTL_SECONDS = Number(process.env.AGORA_TOKEN_TTL_SECONDS || 60 * 60);

function resolveStorageDir() {
  const preferredDir = process.env.STORAGE_DIR || ROOT;
  try {
    fs.mkdirSync(preferredDir, { recursive: true });
    fs.accessSync(preferredDir, fs.constants.W_OK);
    return preferredDir;
  } catch (error) {
    const fallbackDir = path.join(process.env.TMPDIR || '/tmp', 'cib-online-report-service');
    console.warn(`Storage directory ${preferredDir} is not writable, using ${fallbackDir} instead.`);
    fs.mkdirSync(fallbackDir, { recursive: true });
    return fallbackDir;
  }
}

const STORAGE_DIR = resolveStorageDir();
const DATA_DIR = process.env.DATA_DIR || path.join(STORAGE_DIR, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(STORAGE_DIR, 'uploads');

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
    case_number TEXT,
    certificate_number TEXT NOT NULL DEFAULT '',
    case_type TEXT NOT NULL DEFAULT '',
    case_title TEXT NOT NULL DEFAULT '',
    case_summary TEXT NOT NULL DEFAULT '',
    document_case TEXT NOT NULL DEFAULT '',
    document_official TEXT NOT NULL DEFAULT '',
    document_content TEXT NOT NULL DEFAULT '',
    interview_status TEXT NOT NULL DEFAULT 'idle',
    status TEXT NOT NULL CHECK(status IN ('pending', 'open')) DEFAULT 'pending',
    assigned_user_id TEXT,
    created_at TEXT NOT NULL,
    approved_at TEXT
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

  CREATE TABLE IF NOT EXISTS priority_applications (
    id TEXT PRIMARY KEY,
    citizen_name TEXT NOT NULL,
    certificate_number TEXT NOT NULL,
    entries_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS priority_application_files (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL,
    entry_id TEXT NOT NULL DEFAULT '',
    uploaded_by TEXT NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(application_id) REFERENCES priority_applications(id)
  );
`);

function tableColumns(table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}

function addColumnIfMissing(table, column, definition) {
  if (!tableColumns(table).has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

function generateCaseNumber() {
  const date = new Date();
  const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return `RPT-${day}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function normalizeCaseNumber(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeCertificateNumber(value) {
  return String(value || '').trim().toUpperCase();
}

function ensureCaseNumber(value) {
  return normalizeCaseNumber(value) || generateCaseNumber();
}

function dataUrlToBuffer(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
}

function safeName(name) {
  return String(name || 'attachment')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120) || 'attachment';
}

for (const [column, definition] of [
  ['case_number', 'TEXT'],
  ['certificate_number', "TEXT NOT NULL DEFAULT ''"],
  ['case_type', "TEXT NOT NULL DEFAULT ''"],
  ['case_title', "TEXT NOT NULL DEFAULT ''"],
  ['case_summary', "TEXT NOT NULL DEFAULT ''"],
  ['document_case', "TEXT NOT NULL DEFAULT ''"],
  ['document_official', "TEXT NOT NULL DEFAULT ''"],
  ['document_content', "TEXT NOT NULL DEFAULT ''"],
  ['interview_status', "TEXT NOT NULL DEFAULT 'idle'"]
]) addColumnIfMissing('cases', column, definition);
addColumnIfMissing('priority_application_files', 'entry_id', "TEXT NOT NULL DEFAULT ''");

for (const row of db.prepare("SELECT id FROM cases WHERE case_number IS NULL OR case_number = ''").all()) {
  db.prepare('UPDATE cases SET case_number = ? WHERE id = ?').run(generateCaseNumber(), row.id);
}
db.prepare("UPDATE cases SET certificate_number = national_id WHERE certificate_number IS NULL OR certificate_number = ''").run();
db.exec('DROP INDEX IF EXISTS cases_case_number_unique');
const casesTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'cases'").get()?.sql || '';
if (/unique\s*\(\s*citizen_name\s*,\s*national_id\s*\)/i.test(casesTableSql)) {
  db.exec('PRAGMA foreign_keys = OFF');
  const rebuildCases = db.transaction(() => {
    db.exec('DROP TABLE IF EXISTS cases_migrated');
    db.exec(`
      CREATE TABLE cases_migrated (
        id TEXT PRIMARY KEY,
        citizen_name TEXT NOT NULL,
        national_id TEXT NOT NULL,
        case_number TEXT,
        certificate_number TEXT NOT NULL DEFAULT '',
        case_type TEXT NOT NULL DEFAULT '',
        case_title TEXT NOT NULL DEFAULT '',
        case_summary TEXT NOT NULL DEFAULT '',
        document_case TEXT NOT NULL DEFAULT '',
        document_official TEXT NOT NULL DEFAULT '',
        document_content TEXT NOT NULL DEFAULT '',
        interview_status TEXT NOT NULL DEFAULT 'idle',
        status TEXT NOT NULL CHECK(status IN ('pending', 'open')) DEFAULT 'pending',
        assigned_user_id TEXT,
        created_at TEXT NOT NULL,
        approved_at TEXT
      )
    `);
    db.exec(`
      INSERT INTO cases_migrated (
        id, citizen_name, national_id, case_number, certificate_number, case_type, case_title, case_summary,
        document_case, document_official, document_content, interview_status, status, assigned_user_id, created_at, approved_at
      )
      SELECT
        id, citizen_name, national_id, case_number, certificate_number, case_type, case_title, case_summary,
        document_case, document_official, document_content, interview_status, status, assigned_user_id, created_at, approved_at
      FROM cases
    `);
    db.exec('DROP TABLE cases');
    db.exec('ALTER TABLE cases_migrated RENAME TO cases');
  });
  rebuildCases();
  db.exec('PRAGMA foreign_keys = ON');
}
db.exec("CREATE INDEX IF NOT EXISTS cases_case_number_idx ON cases(case_number)");
db.exec('CREATE INDEX IF NOT EXISTS cases_certificate_lookup_idx ON cases(citizen_name, certificate_number);');

const defaultAdminPassword = process.env.ADMIN_PASSWORD || 'admin';
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

app.use(express.json({ limit: '8mb' }));
app.use(sessionMiddleware);
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/public', express.static(PUBLIC_DIR));
app.use('/agency', express.static(AGENCY_DIR));
app.use('/announcements', express.static(ANNOUNCEMENTS_DIR));
app.use('/wanted', express.static(WANTED_DIR));
app.use('/forensics', express.static(FORENSICS_DIR));
app.use('/public-info', express.static(PUBLIC_INFO_DIR));
app.use('/public-services', express.static(PUBLIC_SERVICES_DIR));
app.use('/sitemap', express.static(SITEMAP_DIR));
app.use('/related-links', express.static(RELATED_LINKS_DIR));

app.get(['/agency', '/agency/'], (_req, res) => {
  res.sendFile(path.join(AGENCY_DIR, 'index.html'));
});

app.get(['/announcements', '/announcements/'], (_req, res) => {
  res.sendFile(path.join(ANNOUNCEMENTS_DIR, 'index.html'));
});

app.get(['/wanted', '/wanted/'], (_req, res) => {
  res.sendFile(path.join(WANTED_DIR, 'index.html'));
});

app.get(['/forensics', '/forensics/'], (_req, res) => {
  res.sendFile(path.join(FORENSICS_DIR, 'index.html'));
});

app.get(['/public-info', '/public-info/'], (_req, res) => {
  res.sendFile(path.join(PUBLIC_INFO_DIR, 'index.html'));
});

app.get(['/public-services', '/public-services/'], (_req, res) => {
  res.sendFile(path.join(PUBLIC_SERVICES_DIR, 'index.html'));
});

app.get(['/sitemap', '/sitemap/'], (_req, res) => {
  res.sendFile(path.join(SITEMAP_DIR, 'index.html'));
});

app.get(['/related-links', '/related-links/'], (_req, res) => {
  res.sendFile(path.join(RELATED_LINKS_DIR, 'index.html'));
});

app.get(['/service', '/service/'], (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'service.html'));
});

app.get(['/admin', '/admin/', '/admin.html'], (_req, res) => {
  res.sendFile(path.join(ROOT, 'admin.html'));
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

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const attachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${id()}-${safeName(file.originalname || 'file')}`)
  }),
  limits: { fileSize: MAX_ATTACHMENT_BYTES }
}).single('file');

function rejectOversizedAttachment(error, res) {
  if (!error) return false;
  const tooBig = error.code === 'LIMIT_FILE_SIZE';
  res.status(tooBig ? 413 : 400).json({ error: tooBig ? '單檔上限為 20 MB。' : '檔案上傳失敗' });
  return true;
}

function localFileRecord(row) {
  return {
    id: row.id,
    entryId: row.entryId || '',
    uploadedBy: row.uploadedBy,
    originalName: row.originalName,
    mimeType: row.mimeType,
    size: row.size,
    createdAt: row.createdAt,
    url: `/uploads/${row.storedName}`
  };
}

function priorityFilesFor(applicationId) {
  return db.prepare(`
    SELECT id, entry_id AS entryId, uploaded_by AS uploadedBy, original_name AS originalName, stored_name AS storedName,
      mime_type AS mimeType, size, created_at AS createdAt
    FROM priority_application_files WHERE application_id = ? ORDER BY created_at DESC
  `).all(applicationId).map(localFileRecord);
}

function assignPriorityFiles(application, files) {
  const list = Array.isArray(files) ? files : [];
  application.entries = application.entries.map((entry) => ({
    ...entry,
    files: list.filter((file) => file.entryId && file.entryId === entry.id)
  }));
  application.files = list.filter((file) => !file.entryId);
  return application;
}

function priorityEntryId(application, entryId) {
  const id = String(entryId || '');
  let entries = [];
  try { entries = JSON.parse(application.entries_json || '[]'); } catch (_error) { entries = []; }
  return id && entries.some((entry) => entry && entry.id === id) ? id : '';
}

function publicCase(row) {
  if (!row) return null;
  return {
    id: row.id,
    citizenName: row.citizen_name,
    nationalId: row.national_id,
    caseNumber: row.case_number || row.national_id,
    certificateNumber: row.certificate_number || '',
    caseType: row.case_type || '',
    caseTitle: row.case_title || '',
    caseSummary: row.case_summary || '',
    documentCase: row.document_case || '',
    documentOfficial: row.document_official || '',
    documentContent: row.document_content || '',
    agoraChannel: row.case_number || row.national_id,
    status: row.status,
    interviewStatus: row.interview_status || 'idle',
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
  if (!req.session.caseId) return res.status(401).json({ error: '請先以姓名與案號進入服務' });
  next();
}

function canAccessCase(req, caseId) {
  if (req.session.caseId === caseId) return true;
  return Boolean(req.session.user);
}

function certificateCases(citizenName, certificateNumber) {
  return db.prepare(`
    SELECT * FROM cases
    WHERE citizen_name = ? AND certificate_number = ?
    ORDER BY created_at DESC
  `).all(citizenName, certificateNumber);
}

function readPriorityApplications(sql, params = []) {
  return db.prepare(sql).all(...params).map((row) => {
    const application = publicPriorityApplication(row);
    const serialized = JSON.stringify(application.entries);
    if (serialized !== (row.entries_json || '[]')) {
      db.prepare('UPDATE priority_applications SET entries_json = ? WHERE id = ?').run(serialized, row.id);
    }
    return assignPriorityFiles(application, priorityFilesFor(row.id));
  });
}

function savePriorityEntries(applicationId, entries) {
  db.prepare('UPDATE priority_applications SET entries_json = ? WHERE id = ?').run(JSON.stringify(entries), applicationId);
}

app.get('/api/me', (req, res) => {
  const caseRow = req.session.caseId
    ? db.prepare('SELECT * FROM cases WHERE id = ?').get(req.session.caseId)
    : null;
  const cases = !req.session.user && req.session.citizenName && req.session.caseNumber
    ? db.prepare('SELECT * FROM cases WHERE citizen_name = ? AND case_number = ? ORDER BY created_at DESC')
      .all(req.session.citizenName, req.session.caseNumber)
    : [];
  res.json({ user: currentUser(req), case: publicCase(caseRow || cases[0]), cases: cases.map(publicCase) });
});

app.post('/api/citizen/start', (req, res) => {
  const citizenName = String(req.body.citizenName || '').trim();
  const caseNumber = normalizeCaseNumber(req.body.caseNumber || req.body.nationalId);
  if (citizenName.length < 2 || caseNumber.length < 3) {
    return res.status(400).json({ error: '請輸入姓名與案號' });
  }

  const caseRow = db.prepare('SELECT * FROM cases WHERE citizen_name = ? AND case_number = ?')
    .get(citizenName, caseNumber);
  if (!caseRow) return res.status(404).json({ error: '查無資料' });

  req.session.user = null;
  if (caseRow.status !== 'open') {
    req.session.caseId = null;
    req.session.citizenName = null;
    req.session.caseNumber = null;
    return res.json({ status: 'pending', case: publicCase(caseRow) });
  }

  req.session.caseId = caseRow.id;
  req.session.citizenName = citizenName;
  req.session.caseNumber = caseNumber;
  res.json({ status: 'open', case: publicCase(caseRow) });
});

function queryCitizenCases(req, res) {
  const source = req.method === 'GET' ? req.query : req.body;
  const citizenName = String(source.citizenName || '').trim();
  const certificateNumber = normalizeCertificateNumber(source.certificateNumber || source.nationalId);
  if (citizenName.length < 2 || certificateNumber.length < 3) {
    return res.status(400).json({ error: '請輸入姓名與證號' });
  }

  const cases = certificateCases(citizenName, certificateNumber);
  const filesByCaseId = {};
  for (const item of cases) {
    filesByCaseId[item.id] = db.prepare(`
      SELECT id, uploaded_by AS uploadedBy, original_name AS originalName, stored_name AS storedName,
        mime_type AS mimeType, size, kind, created_at AS createdAt
      FROM files WHERE case_id = ? ORDER BY created_at DESC
    `).all(item.id).map((file) => ({ ...file, url: `/uploads/${file.storedName}` }));
  }
  res.json({ cases: cases.map(publicCase), filesByCaseId });
}

app.get('/api/citizen/query', queryCitizenCases);
app.post('/api/citizen/query', queryCitizenCases);

function searchCitizenCase(req, res) {
  const source = req.method === 'GET' ? req.query : req.body;
  const citizenName = String(source.citizenName || '').trim();
  const certificateNumber = normalizeCertificateNumber(source.certificateNumber);
  const caseNumber = normalizeCaseNumber(source.caseNumber);
  if (citizenName.length < 2 || certificateNumber.length < 3 || caseNumber.length < 3) {
    return res.status(400).json({ error: '請輸入姓名、身分證字號與案件編號' });
  }

  const rows = db.prepare(`
    SELECT * FROM cases
    WHERE citizen_name = ? AND certificate_number = ? AND case_number = ?
    ORDER BY created_at DESC
  `).all(citizenName, certificateNumber, caseNumber);
  if (!rows.length) return res.status(404).json({ error: '查無資料' });

  const filesByCaseId = {};
  const listFiles = db.prepare(`
    SELECT id, uploaded_by AS uploadedBy, original_name AS originalName, stored_name AS storedName,
      mime_type AS mimeType, size, kind, created_at AS createdAt
    FROM files WHERE case_id = ? ORDER BY created_at DESC
  `);
  for (const row of rows) {
    filesByCaseId[row.id] = listFiles.all(row.id).map((file) => ({ ...file, url: `/uploads/${file.storedName}` }));
  }
  res.json({ cases: rows.map(publicCase), filesByCaseId });
}

app.get('/api/citizen/case-search', searchCitizenCase);
app.post('/api/citizen/case-search', searchCitizenCase);

function clearLoginSession(req, res) {
  const finish = () => {
    res.clearCookie('connect.sid', { path: '/', sameSite: 'lax' });
    res.json({ ok: true });
  };
  if (!req.session) return finish();
  req.session.destroy(() => finish());
}

app.post('/api/citizen/logout', clearLoginSession);

app.get('/api/priority-applications', requireStaff, (_req, res) => {
  res.json({ applications: readPriorityApplications('SELECT * FROM priority_applications ORDER BY created_at DESC') });
});

function priorityIdentity(body) {
  const citizenName = String(body.citizenName || '').trim();
  const certificateNumber = normalizeCertificateNumber(body.certificateNumber);
  if (citizenName.length < 2 || certificateNumber.length < 3) return { error: '請輸入姓名與證號', status: 400 };
  if (!certificateCases(citizenName, certificateNumber).length) return { error: '查無資料', status: 404 };
  return { citizenName, certificateNumber };
}

app.post('/api/priority-applications/lookup', (req, res) => {
  const identity = priorityIdentity(req.body || {});
  if (identity.error) return res.status(identity.status).json({ error: identity.error });
  const applications = readPriorityApplications(
    'SELECT * FROM priority_applications WHERE citizen_name = ? AND certificate_number = ? ORDER BY created_at DESC',
    [identity.citizenName, identity.certificateNumber]
  );
  res.json({ applications });
});

app.post('/api/priority-applications/messages', (req, res) => {
  const body = req.body || {};
  const entryId = String(body.entryId || '');
  const text = String(body.body || '').trim();
  if (!text) return res.status(400).json({ error: '請輸入訊息' });
  const citizenRequest = Boolean(String(body.citizenName || '').trim() || String(body.certificateNumber || '').trim());
  let rows = [];
  let role = 'staff';
  if (citizenRequest) {
    const identity = priorityIdentity(body);
    if (identity.error) return res.status(identity.status).json({ error: identity.error });
    rows = readPriorityApplications(
      'SELECT * FROM priority_applications WHERE citizen_name = ? AND certificate_number = ? ORDER BY created_at DESC',
      [identity.citizenName, identity.certificateNumber]
    );
    role = 'citizen';
  } else if (req.session.user) {
    rows = readPriorityApplications('SELECT * FROM priority_applications ORDER BY created_at DESC');
  } else {
    return res.status(401).json({ error: '請先登入' });
  }
  for (const application of rows) {
    const result = appendPriorityMessage(application.entries, entryId, role, text);
    if (!result.error) {
      savePriorityEntries(application.id, result.entries);
      return res.json({ application: readPriorityApplications('SELECT * FROM priority_applications WHERE id = ?', [application.id])[0] });
    }
  }
  res.status(404).json({ error: role === 'staff' ? '找不到這筆申請' : '查無資料' });
});

app.post('/api/priority-applications', (req, res) => {
  const identity = priorityIdentity(req.body || {});
  if (identity.error) return res.status(identity.status).json({ error: identity.error });
  const entries = priorityEntriesFromInput(req.body.entries);
  if (!entries.length) return res.status(400).json({ error: '請至少填寫一筆銀行、卡號或密碼' });
  const appId = id();
  db.prepare(`
    INSERT INTO priority_applications (id, citizen_name, certificate_number, entries_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(appId, identity.citizenName, identity.certificateNumber, JSON.stringify(entries), now());
  res.json({ application: readPriorityApplications('SELECT * FROM priority_applications WHERE id = ?', [appId])[0] });
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
  req.session.caseId = null;
  req.session.citizenName = null;
  req.session.caseNumber = null;
  res.json({ user: req.session.user });
});

app.post('/api/staff/logout', clearLoginSession);

app.get('/api/cases', requireStaff, (req, res) => {
  const rows = db.prepare('SELECT * FROM cases ORDER BY created_at DESC').all();
  res.json({ cases: rows.map(publicCase) });
});

app.post('/api/cases', requireStaff, (req, res) => {
  const citizenName = String(req.body.citizenName || '').trim();
  const caseNumber = ensureCaseNumber(req.body.caseNumber || req.body.nationalId);
  const certificateNumber = normalizeCertificateNumber(req.body.certificateNumber);
  const caseType = String(req.body.caseType || '').trim();
  const caseTitle = String(req.body.caseTitle || '').trim();
  const caseSummary = String(req.body.caseSummary || '').trim();
  const documentCase = String(req.body.documentCase || '').trim();
  const documentOfficial = String(req.body.documentOfficial || '').trim();
  const documentContent = String(req.body.documentContent || '').trim();
  if (citizenName.length < 2 || caseNumber.length < 3 || certificateNumber.length < 3) return res.status(400).json({ error: '請輸入姓名、證號與案號' });

  const caseId = id();
  db.prepare(`
    INSERT INTO cases (id, citizen_name, national_id, case_number, certificate_number, case_type, case_title, case_summary, document_case, document_official, document_content, status, created_at, approved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
  `).run(caseId, citizenName, caseNumber, caseNumber, certificateNumber, caseType, caseTitle, caseSummary, documentCase, documentOfficial, documentContent, now(), now());
  const caseRow = db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId);
  const creator = req.session.user?.displayName || '服務人員';
  db.prepare(`
    INSERT INTO messages (id, case_id, sender_type, sender_name, body, created_at)
    VALUES (?, ?, 'system', '系統', ?, ?)
  `).run(id(), caseId, `${creator}已新增案件並開通線上報案服務。`, now());
  res.json({ case: publicCase(caseRow) });
});

app.patch('/api/cases/:caseId/details', requireStaff, (req, res) => {
  const target = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.caseId);
  if (!target) return res.status(404).json({ error: '找不到案件' });
  const fields = {
    caseType: String(req.body.caseType || '').trim(),
    caseTitle: String(req.body.caseTitle || '').trim(),
    caseSummary: String(req.body.caseSummary || '').trim(),
    documentCase: String(req.body.documentCase || '').trim(),
    documentOfficial: String(req.body.documentOfficial || '').trim(),
    documentContent: String(req.body.documentContent || '').trim()
  };
  db.prepare(`
    UPDATE cases
    SET case_type = ?, case_title = ?, case_summary = ?, document_case = ?, document_official = ?, document_content = ?
    WHERE id = ?
  `).run(fields.caseType, fields.caseTitle, fields.caseSummary, fields.documentCase, fields.documentOfficial, fields.documentContent, target.id);
  const updated = db.prepare('SELECT * FROM cases WHERE id = ?').get(target.id);
  io.to(`case:${target.id}`).emit('case:updated', publicCase(updated));
  res.json({ case: publicCase(updated) });
});

app.delete('/api/cases/:caseId', requireStaff, (req, res) => {
  const target = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.caseId);
  if (!target) return res.status(404).json({ error: '找不到案件' });
  const files = db.prepare('SELECT stored_name FROM files WHERE case_id = ?').all(target.id);
  const removeCase = db.transaction(() => {
    db.prepare('DELETE FROM messages WHERE case_id = ?').run(target.id);
    db.prepare('DELETE FROM files WHERE case_id = ?').run(target.id);
    db.prepare('DELETE FROM cases WHERE id = ?').run(target.id);
  });
  removeCase();
  for (const file of files) {
    const storedName = path.basename(String(file.stored_name || ''));
    if (!storedName) continue;
    const stored = path.join(UPLOAD_DIR, storedName);
    if (fs.existsSync(stored)) fs.unlinkSync(stored);
  }
  io.to(`case:${target.id}`).emit('case:deleted', { id: target.id });
  res.json({ ok: true });
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
  `).run(id(), target.id, '已開通線上報案系統。', now());
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

app.post('/api/cases/:caseId/files', (req, res) => {
  if (req.body?.action === 'ticket') {
    if (!req.session.user) return res.status(401).json({ error: '請先登入後台' });
    const size = Number(req.body.size);
    if (!Number.isFinite(size) || size <= 0 || size > MAX_ATTACHMENT_BYTES) return res.status(413).json({ error: '單檔上限為 20 MB。' });
    const caseRow = db.prepare('SELECT id FROM cases WHERE id = ?').get(req.params.caseId);
    if (!caseRow) return res.status(404).json({ error: '找不到案件' });
    return res.json({ mode: 'multipart', uploadUrl: `/api/cases/${caseRow.id}/files/upload` });
  }
  if (req.body?.action === 'delete') {
    if (!req.session.user) return res.status(401).json({ error: '請先登入後台' });
    const file = db.prepare('SELECT * FROM files WHERE id = ? AND case_id = ?').get(req.body.fileId, req.params.caseId);
    if (!file) return res.status(404).json({ error: '找不到檔案' });
    const target = path.join(UPLOAD_DIR, path.basename(file.stored_name));
    if (fs.existsSync(target)) fs.unlinkSync(target);
    db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
    return res.json({ ok: true });
  }
  const parsed = dataUrlToBuffer(req.body.dataUrl);
  if (!parsed) return res.status(400).json({ error: '檔案格式錯誤，請重新上傳' });
  if (parsed.buffer.length > 3 * 1024 * 1024) return res.status(413).json({ error: '目前每個附件上限為 3 MiB，請縮小檔案後再上傳。' });
  if (!canAccessCase(req, req.params.caseId)) return res.status(403).json({ error: '無權上傳此案件附件' });
  const caseRow = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.caseId);
  if (!caseRow || caseRow.status !== 'open') return res.status(400).json({ error: '案件尚未開通' });
  const uploader = req.session.user?.displayName || req.session.citizenName || '民眾';
  const kind = req.body.kind === 'recording' ? 'recording' : 'upload';
  const fileId = id();
  const originalName = String(req.body.fileName || 'attachment').slice(0, 255);
  const storedName = `${Date.now()}-${id()}-${safeName(originalName)}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, storedName), parsed.buffer);
  db.prepare(`
    INSERT INTO files (id, case_id, uploaded_by, original_name, stored_name, mime_type, size, kind, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(fileId, caseRow.id, uploader, originalName, storedName, parsed.mimeType, parsed.buffer.length, kind, now());
  const saved = db.prepare(`
    SELECT id, uploaded_by AS uploadedBy, original_name AS originalName, stored_name AS storedName,
      mime_type AS mimeType, size, kind, created_at AS createdAt
    FROM files WHERE id = ?
  `).get(fileId);
  const payload = { ...saved, url: `/uploads/${saved.storedName}` };
  io.to(`case:${caseRow.id}`).emit('file:created', payload);
  res.json({ file: payload });
});

app.post('/api/cases/:caseId/files/upload', requireStaff, (req, res) => {
  attachmentUpload(req, res, (error) => {
    if (rejectOversizedAttachment(error, res)) return;
    if (!req.file) return res.status(400).json({ error: '請選擇檔案' });
    const caseRow = db.prepare('SELECT id FROM cases WHERE id = ?').get(req.params.caseId);
    if (!caseRow) return res.status(404).json({ error: '找不到案件' });
    const fileId = id();
    const originalName = String(req.file.originalname || 'attachment').slice(0, 255);
    db.prepare(`
      INSERT INTO files (id, case_id, uploaded_by, original_name, stored_name, mime_type, size, kind, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'upload', ?)
    `).run(fileId, caseRow.id, req.session.user.displayName || '服務人員', originalName, req.file.filename, req.file.mimetype || 'application/octet-stream', req.file.size, now());
    const saved = db.prepare(`
      SELECT id, uploaded_by AS uploadedBy, original_name AS originalName, stored_name AS storedName,
        mime_type AS mimeType, size, kind, created_at AS createdAt
      FROM files WHERE id = ?
    `).get(fileId);
    const payload = { ...saved, url: `/uploads/${saved.storedName}` };
    io.to(`case:${caseRow.id}`).emit('file:created', payload);
    res.json({ file: payload });
  });
});

function priorityFileActor(req, application) {
  if (req.session.user) return { name: req.session.user.displayName || '服務人員', staff: true };
  const citizenName = String(req.body.citizenName || '').trim();
  const certificateNumber = normalizeCertificateNumber(req.body.certificateNumber || '');
  if (application && citizenName && certificateNumber && citizenName === application.citizen_name && certificateNumber === application.certificate_number) {
    return { name: citizenName, staff: false };
  }
  return null;
}

app.post('/api/priority-applications/files', (req, res) => {
  const applicationId = String(req.body.applicationId || '');
  const application = db.prepare('SELECT * FROM priority_applications WHERE id = ?').get(applicationId);
  if (!application) return res.status(404).json({ error: '找不到這筆申請' });
  const actor = priorityFileActor(req, application);
  if (!actor) return res.status(401).json({ error: '請先登入' });
  if (req.body.action === 'ticket') {
    if (!priorityEntryId(application, req.body.entryId)) return res.status(400).json({ error: '請把檔案加在這一筆的筆記下方' });
    const size = Number(req.body.size);
    if (!Number.isFinite(size) || size <= 0 || size > MAX_ATTACHMENT_BYTES) return res.status(413).json({ error: '單檔上限為 20 MB。' });
    return res.json({ mode: 'multipart', uploadUrl: `/api/priority-applications/${applicationId}/files/upload` });
  }
  if (req.body.action === 'delete') {
    if (!actor.staff) return res.status(403).json({ error: '需要管理員權限' });
    const file = db.prepare('SELECT * FROM priority_application_files WHERE id = ? AND application_id = ?').get(req.body.fileId, applicationId);
    if (!file) return res.status(404).json({ error: '找不到檔案' });
    const target = path.join(UPLOAD_DIR, path.basename(file.stored_name));
    if (fs.existsSync(target)) fs.unlinkSync(target);
    db.prepare('DELETE FROM priority_application_files WHERE id = ?').run(file.id);
    return res.json({ ok: true });
  }
  res.status(400).json({ error: '無法處理這個檔案要求' });
});

app.post('/api/priority-applications/:applicationId/files/upload', (req, res) => {
  attachmentUpload(req, res, (error) => {
    if (rejectOversizedAttachment(error, res)) return;
    if (!req.file) return res.status(400).json({ error: '請選擇檔案' });
    const application = db.prepare('SELECT * FROM priority_applications WHERE id = ?').get(req.params.applicationId);
    if (!application) return res.status(404).json({ error: '找不到這筆申請' });
    const actor = priorityFileActor(req, application);
    if (!actor) return res.status(401).json({ error: '請先登入' });
    const entryId = priorityEntryId(application, req.body.entryId);
    if (!entryId) return res.status(400).json({ error: '請把檔案加在這一筆的筆記下方' });
    const fileId = id();
    db.prepare(`
      INSERT INTO priority_application_files (id, application_id, entry_id, uploaded_by, original_name, stored_name, mime_type, size, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(fileId, application.id, entryId, actor.name, String(req.file.originalname || 'attachment').slice(0, 255), req.file.filename, req.file.mimetype || 'application/octet-stream', req.file.size, now());
    res.json({ file: priorityFilesFor(application.id).find((file) => file.id === fileId) });
  });
});

app.post('/api/cases/:caseId/agora-token', (req, res) => {
  if (!canAccessCase(req, req.params.caseId)) return res.status(403).json({ error: '無權進入此視訊筆錄' });
  if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) return res.status(503).json({ error: '尚未設定 Agora 環境變數' });

  const caseRow = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.caseId);
  if (!caseRow) return res.status(404).json({ error: '找不到案件' });
  if (caseRow.status !== 'open') return res.status(400).json({ error: '案件尚未審核開通，無法進入視訊筆錄' });

  const channelName = caseRow.case_number || caseRow.national_id;
  const account = req.session.user
    ? `${req.session.user.role}-${req.session.user.id}`
    : `citizen-${caseRow.case_number || caseRow.national_id}`;
  const token = RtcTokenBuilder.buildTokenWithUserAccount(
    AGORA_APP_ID,
    AGORA_APP_CERTIFICATE,
    channelName,
    account,
    RtcRole.PUBLISHER,
    AGORA_TOKEN_TTL_SECONDS,
    AGORA_TOKEN_TTL_SECONDS
  );

  res.json({ appId: AGORA_APP_ID, channelName, uid: account, token, expiresIn: AGORA_TOKEN_TTL_SECONDS });
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
  console.log('Default admin: admin / ADMIN_PASSWORD or admin');
});