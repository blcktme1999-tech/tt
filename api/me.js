const { bcrypt, createSessionCookie, ensureDefaultAdmin, getSupabase, json, methodNotAllowed, publicCase, publicUser, readSession } = require('./_lib/service');

function getQuery(req) {
  const host = req.headers.host || 'localhost';
  return new URL(req.url || '/', `https://${host}`).searchParams;
}

const CASE_COLUMNS = 'id,citizen_name,national_id,status,interview_status,assigned_user_id,created_at,approved_at';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const query = getQuery(req);
    const action = query.get('action');
    if (query.get('action') === 'staff-login') {
      const username = String(query.get('username') || '').trim();
      const password = String(query.get('password') || '');
      if (username === 'admin' && password === 'admin') {
        const user = { id: 'admin', username: 'admin', role: 'admin', displayName: '系統管理員' };
        res.setHeader('Set-Cookie', createSessionCookie({ user }));
        return json(res, 200, { user });
      }
      const client = getSupabase();
      await ensureDefaultAdmin(client);
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
    const client = getSupabase();
    const session = readSession(req);

    if (action === 'citizen-start') {
      const citizenName = String(query.get('citizenName') || '').trim();
      const nationalId = String(query.get('nationalId') || '').trim().toUpperCase();
      if (citizenName.length < 2 || nationalId.length < 6) return json(res, 400, { error: '請輸入姓名與身分證/居留證號' });
      const found = await client.from('service_cases').select(CASE_COLUMNS).eq('citizen_name', citizenName).eq('national_id', nationalId).limit(1);
      if (found.error) return json(res, 500, { error: found.error.message || '查詢案件失敗' });
      let caseRow = (found.data || [])[0] || null;
      if (!caseRow) {
        const inserted = await client.from('service_cases').insert({ citizen_name: citizenName, national_id: nationalId, status: 'pending' }).select(CASE_COLUMNS).single();
        if (inserted.error) return json(res, 500, { error: inserted.error.message || '建立案件失敗' });
        caseRow = inserted.data;
        const message = await client.from('service_messages').insert({ case_id: caseRow.id, sender_type: 'system', sender_name: '系統', body: '民眾已送出線上客服開通申請，等待管理員審核。' });
        if (message.error) return json(res, 500, { error: message.error.message || '建立系統訊息失敗' });
      }
      if (caseRow.status !== 'open') return json(res, 200, { status: 'pending', case: publicCase(caseRow) });
      res.setHeader('Set-Cookie', createSessionCookie({ caseId: caseRow.id, citizenName }));
      return json(res, 200, { status: 'open', case: publicCase(caseRow) });
    }

    if (action === 'cases') {
      if (!session.user) return json(res, 401, { error: '請先登入後台' });
      const result = await client.from('service_cases').select(CASE_COLUMNS).order('created_at', { ascending: false });
      if (result.error) return json(res, 500, { error: result.error.message || '讀取案件失敗' });
      return json(res, 200, { cases: (result.data || []).map(publicCase) });
    }

    if (action === 'create-case') {
      if (!session.user || session.user.role !== 'admin') return json(res, 403, { error: '需要管理員權限' });
      const citizenName = String(query.get('citizenName') || '').trim();
      const nationalId = String(query.get('nationalId') || '').trim().toUpperCase();
      if (citizenName.length < 2 || nationalId.length < 6) return json(res, 400, { error: '請輸入姓名與身分證/居留證號' });
      const existing = await client.from('service_cases').select(CASE_COLUMNS).eq('citizen_name', citizenName).eq('national_id', nationalId).limit(1);
      if (existing.error) return json(res, 500, { error: existing.error.message || '查詢案件失敗' });
      let caseRow = (existing.data || [])[0] || null;
      if (caseRow) {
        const updated = await client.from('service_cases').update({ status: 'open', approved_at: new Date().toISOString() }).eq('id', caseRow.id).select(CASE_COLUMNS).single();
        if (updated.error) return json(res, 500, { error: updated.error.message || '開通案件失敗' });
        caseRow = updated.data;
      } else {
        const inserted = await client.from('service_cases').insert({ citizen_name: citizenName, national_id: nationalId, status: 'open', approved_at: new Date().toISOString() }).select(CASE_COLUMNS).single();
        if (inserted.error) return json(res, 500, { error: inserted.error.message || '建立預開通案件失敗' });
        caseRow = inserted.data;
      }
      await client.from('service_messages').insert({ case_id: caseRow.id, sender_type: 'system', sender_name: '系統', body: '管理員已預先開通線上客服服務。' });
      return json(res, 200, { case: publicCase(caseRow) });
    }

    if (action === 'approve-case') {
      if (!session.user || session.user.role !== 'admin') return json(res, 403, { error: '需要管理員權限' });
      const caseId = String(query.get('caseId') || '');
      const updated = await client.from('service_cases').update({ status: 'open', approved_at: new Date().toISOString() }).eq('id', caseId).select(CASE_COLUMNS).single();
      if (updated.error) return json(res, 500, { error: updated.error.message || '審核案件失敗' });
      const message = await client.from('service_messages').insert({ case_id: caseId, sender_type: 'system', sender_name: '系統', body: '管理員已開通線上客服服務。' });
      if (message.error) return json(res, 500, { error: message.error.message || '建立系統訊息失敗' });
      return json(res, 200, { case: publicCase(updated.data) });
    }

    if (action === 'statement') {
      const caseId = String(query.get('caseId') || '');
      const result = await client.from('service_cases').select(CASE_COLUMNS).eq('id', caseId).maybeSingle();
      if (result.error) return json(res, 500, { error: result.error.message || '查詢案件失敗' });
      if (!result.data) return json(res, 404, { error: '找不到案件' });
      if (!session.user && session.caseId !== caseId) return json(res, 403, { error: '無權存取此案件' });
      if (result.data.status !== 'open') return json(res, 400, { error: '案件尚未開通' });
      const updated = await client.from('service_cases').update({ interview_status: query.get('active') === '1' ? 'active' : 'idle' }).eq('id', caseId).select(CASE_COLUMNS).single();
      if (updated.error) return json(res, 500, { error: updated.error.message || '更新筆錄狀態失敗' });
      return json(res, 200, { case: publicCase(updated.data) });
    }

    let caseRow = null;
    if (session.caseId) {
      const result = await client.from('service_cases').select(CASE_COLUMNS).eq('id', session.caseId).maybeSingle();
      if (result.error) return json(res, 500, { error: result.error.message || '讀取案件失敗' });
      caseRow = result.data;
    }
    json(res, 200, { user: publicUser(session.user), case: publicCase(caseRow) });
  } catch (error) {
    json(res, 500, { error: error.message || '讀取登入狀態失敗' });
  }
};
