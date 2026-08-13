const { bcrypt, createSessionCookie, ensureDefaultAdmin, getJsonBody, getSupabase, json, methodNotAllowed, publicUser } = require('../_lib/service');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const client = getSupabase();
    await ensureDefaultAdmin(client);
    const body = await getJsonBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const result = await client.from('service_users').select('*').eq('username', username).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data || !bcrypt.compareSync(password, result.data.password_hash)) return json(res, 401, { error: '帳號或密碼錯誤' });
    const user = publicUser(result.data);
    res.setHeader('Set-Cookie', createSessionCookie({ user }));
    json(res, 200, { user });
  } catch (error) {
    json(res, 500, { error: error.message || '登入失敗' });
  }
};
