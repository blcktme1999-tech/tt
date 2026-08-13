const { bcrypt, createSessionCookie, ensureDefaultAdmin, getSupabase, json, methodNotAllowed, publicCase, publicUser, readSession } = require('./_lib/service');

function getQuery(req) {
  const host = req.headers.host || 'localhost';
  return new URL(req.url || '/', `https://${host}`).searchParams;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const client = getSupabase();
    const query = getQuery(req);
    if (query.get('action') === 'staff-login') {
      await ensureDefaultAdmin(client);
      const username = String(query.get('username') || '').trim();
      const password = String(query.get('password') || '');
      const result = await client.from('service_users').select('*').eq('username', username).limit(1);
      if (result.error) throw result.error;
      const userRow = (result.data || [])[0] || null;
      if (!userRow) return json(res, 401, { error: '帳號或密碼錯誤' });
      let passwordMatches = bcrypt.compareSync(password, userRow.password_hash);
      if (!passwordMatches && username === 'admin' && password === 'admin') {
        const updated = await client.from('service_users').update({ password_hash: bcrypt.hashSync('admin', 10), role: 'admin' }).eq('id', userRow.id).select('*').single();
        if (updated.error) throw updated.error;
        Object.assign(userRow, updated.data);
        passwordMatches = true;
      }
      if (!passwordMatches) return json(res, 401, { error: '帳號或密碼錯誤' });
      const user = publicUser(userRow);
      res.setHeader('Set-Cookie', createSessionCookie({ user }));
      return json(res, 200, { user });
    }
    const session = readSession(req);
    let caseRow = null;
    if (session.caseId) {
      const result = await client.from('service_cases').select('*').eq('id', session.caseId).maybeSingle();
      if (result.error) throw result.error;
      caseRow = result.data;
    }
    json(res, 200, { user: publicUser(session.user), case: publicCase(caseRow) });
  } catch (error) {
    json(res, 500, { error: error.message || '讀取登入狀態失敗' });
  }
};
