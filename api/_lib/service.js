const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const SESSION_COOKIE = 'cib_service_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;
const VIDEO_BUCKET = process.env.SUPABASE_VIDEO_BUCKET || 'report-videos';

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function methodNotAllowed(res, allowedMethods) {
  res.setHeader('Allow', allowedMethods.join(', '));
  json(res, 405, { error: 'Method not allowed' });
}

async function getJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function getConfig() {
  const config = {
    sessionSecret: process.env.SESSION_SECRET,
    adminPassword: process.env.ADMIN_PASSWORD || 'admin',
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
    agoraAppId: process.env.AGORA_APP_ID,
    agoraAppCertificate: process.env.AGORA_APP_CERTIFICATE,
    agoraTokenTtlSeconds: Number(process.env.AGORA_TOKEN_TTL_SECONDS || process.env.AGORA_TOKEN_EXPIRES_IN || 60 * 60)
  };
  if (!config.sessionSecret || !config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error('Missing required Vercel environment variables.');
  }
  return config;
}

function getSupabase() {
  const config = getConfig();
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((cookies, part) => {
    const trimmed = part.trim();
    if (!trimmed) return cookies;
    const index = trimmed.indexOf('=');
    if (index <= 0) return cookies;
    cookies[trimmed.slice(0, index)] = decodeURIComponent(trimmed.slice(index + 1));
    return cookies;
  }, {});
}

function signPayload(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function createSessionCookie(session) {
  const config = getConfig();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = Buffer.from(JSON.stringify({ ...session, expiresAt })).toString('base64url');
  const signature = signPayload(payload, config.sessionSecret);
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(`${payload}.${signature}`)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`
  ];
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) parts.push('Secure');
  return parts.join('; ');
}

function readSession(req) {
  const config = getConfig();
  const raw = parseCookies(req)[SESSION_COOKIE];
  if (!raw) return {};
  const [payload, signature] = String(raw).split('.');
  if (!payload || !signature || signPayload(payload, config.sessionSecret) !== signature) return {};
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session.expiresAt || session.expiresAt < Math.floor(Date.now() / 1000)) return {};
    return session;
  } catch (_error) {
    return {};
  }
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    displayName: row.display_name || row.displayName,
    createdAt: row.created_at || row.createdAt
  };
}

function publicCase(row) {
  if (!row) return null;
  return {
    id: row.id,
    citizenName: row.citizen_name || row.citizenName,
    agoraChannel: row.national_id || row.agoraChannel,
    status: row.status,
    assignedUserId: row.assigned_user_id || row.assignedUserId,
    createdAt: row.created_at || row.createdAt,
    approvedAt: row.approved_at || row.approvedAt
  };
}

function publicMessage(row) {
  return {
    id: row.id,
    caseId: row.case_id,
    senderType: row.sender_type,
    senderName: row.sender_name,
    body: row.body,
    createdAt: row.created_at
  };
}

function publicFile(row) {
  return {
    id: row.id,
    uploadedBy: row.uploaded_by,
    originalName: row.original_name,
    storedName: row.stored_name,
    mimeType: row.mime_type,
    size: row.size,
    kind: row.kind,
    createdAt: row.created_at,
    url: row.public_url
  };
}

async function ensureDefaultAdmin(client) {
  const config = getConfig();
  const passwordHash = bcrypt.hashSync(config.adminPassword, 10);
  const existing = await client.from('service_users').select('id, password_hash, role, display_name').eq('username', 'admin').maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    const passwordMatches = existing.data.password_hash && bcrypt.compareSync(config.adminPassword, existing.data.password_hash);
    if (passwordMatches && existing.data.role === 'admin') return;
    const updated = await client.from('service_users').update({
      password_hash: passwordMatches ? existing.data.password_hash : passwordHash,
      role: 'admin',
      display_name: existing.data.display_name || '系統管理員'
    }).eq('id', existing.data.id);
    if (updated.error) throw updated.error;
    return;
  }
  const inserted = await client.from('service_users').insert({
    username: 'admin',
    password_hash: passwordHash,
    role: 'admin',
    display_name: '系統管理員'
  });
  if (inserted.error) throw inserted.error;
}

function requireStaff(req, res) {
  const session = readSession(req);
  if (!session.user) {
    json(res, 401, { error: '請先登入後台' });
    return null;
  }
  return session;
}

function requireAdmin(req, res) {
  const session = requireStaff(req, res);
  if (!session) return null;
  if (session.user.role !== 'admin') {
    json(res, 403, { error: '需要管理員權限' });
    return null;
  }
  return session;
}

async function requireCaseAccess(req, res, client, caseId) {
  const session = readSession(req);
  const result = await client.from('service_cases').select('*').eq('id', caseId).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) {
    json(res, 404, { error: '找不到案件' });
    return null;
  }
  if (session.user || session.caseId === caseId) return { session, caseRow: result.data };
  json(res, 403, { error: '無權存取此案件' });
  return null;
}

function dataUrlToBuffer(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
}

function safeName(name) {
  return String(name || 'video.webm').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(0, 120) || 'video.webm';
}

module.exports = {
  VIDEO_BUCKET,
  bcrypt,
  createSessionCookie,
  dataUrlToBuffer,
  ensureDefaultAdmin,
  getConfig,
  getJsonBody,
  getSupabase,
  json,
  methodNotAllowed,
  publicCase,
  publicFile,
  publicMessage,
  publicUser,
  readSession,
  requireAdmin,
  requireCaseAccess,
  requireStaff,
  safeName
};
