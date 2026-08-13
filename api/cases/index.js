const { getJsonBody, getSupabase, json, methodNotAllowed, publicCase, requireAdmin, requireStaff } = require('../_lib/service');

module.exports = async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return methodNotAllowed(res, ['GET', 'POST']);
  try {
    const client = getSupabase();

    if (req.method === 'POST') {
      const session = requireAdmin(req, res);
      if (!session) return;
      const body = await getJsonBody(req);
      const citizenName = String(body.citizenName || '').trim();
      const nationalId = String(body.nationalId || '').trim().toUpperCase();
      if (citizenName.length < 2 || nationalId.length < 6) return json(res, 400, { error: '請輸入姓名與身分證/居留證號' });

      const existing = await client.from('service_cases').select('*').eq('citizen_name', citizenName).eq('national_id', nationalId).limit(1);
      if (existing.error) throw existing.error;
      let caseRow = (existing.data || [])[0] || null;
      if (caseRow) {
        const updated = await client.from('service_cases').update({ status: 'open', approved_at: new Date().toISOString() }).eq('id', caseRow.id).select('*').single();
        if (updated.error) throw updated.error;
        caseRow = updated.data;
      } else {
        const inserted = await client.from('service_cases').insert({ citizen_name: citizenName, national_id: nationalId, status: 'open', approved_at: new Date().toISOString() }).select('*').single();
        if (inserted.error) throw inserted.error;
        caseRow = inserted.data;
      }
      await client.from('service_messages').insert({ case_id: caseRow.id, sender_type: 'system', sender_name: '系統', body: '管理員已預先開通線上客服服務。' });
      return json(res, 200, { case: publicCase(caseRow) });
    }

    const session = requireStaff(req, res);
    if (!session) return;
    const result = await client.from('service_cases').select('*').order('created_at', { ascending: false });
    if (result.error) throw result.error;
    json(res, 200, { cases: (result.data || []).map(publicCase) });
  } catch (error) {
    json(res, 500, { error: error.message || '讀取案件失敗' });
  }
};
