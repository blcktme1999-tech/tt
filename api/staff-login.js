const { bcrypt, createSessionCookie, ensureDefaultAdmin, getSupabase, json, methodNotAllowed, publicUser } = require('./_lib/service');

function getQuery(req) {
  const host = req.headers.host || 'localhost';
  return new URL(req.url || '/', `https://${host}`).searchParams;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const client = getSupabase();
    await ensureDefaultAdmin(client);
    const query = getQuery(req);
    const username = String(query.get('username') || '').trim();
    const password = String(query.get('password') || '');
    const result = await client.from('service_users').select('*').eq('username', username).limit(1);
    if (result.error) throw result.error;
    const userRow = (result.data || [])[0] || null;
    if (!userRow || !bcrypt.compareSync(password, userRow.password_hash)) return json(res, 401, { error: '帳號或密碼錯誤' });
    const user = publicUser(userRow);
    res.setHeader('Set-Cookie', createSessionCookie({ user }));
    json(res, 200, { user });
  } catch (error) {
    json(res, 500, { error: error.message || '登入失敗' });
  }
};