const { createSessionCookie, getSupabase, json, methodNotAllowed, publicCase } = require('./_lib/service');

function getQuery(req) {
  const host = req.headers.host || 'localhost';
  return new URL(req.url || '/', `https://${host}`).searchParams;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const client = getSupabase();
    const query = getQuery(req);
    const citizenName = String(query.get('citizenName') || '').trim();
    const nationalId = String(query.get('nationalId') || '').trim().toUpperCase();
    if (citizenName.length < 2 || nationalId.length < 6) return json(res, 400, { error: '請輸入姓名與身分證/居留證號' });

    const found = await client.from('service_cases').select('*').eq('citizen_name', citizenName).eq('national_id', nationalId).order('created_at', { ascending: false });
    if (found.error) throw found.error;
    let cases = found.data || [];
    let caseRow = cases[0] || null;

    if (!caseRow) {
      const inserted = await client.from('service_cases').insert({ citizen_name: citizenName, national_id: nationalId, status: 'open', approved_at: new Date().toISOString() }).select('*').single();
      if (inserted.error) throw inserted.error;
      caseRow = inserted.data;
      cases = [caseRow];
      const message = await client.from('service_messages').insert({ case_id: caseRow.id, sender_type: 'system', sender_name: '警政系統', body: '民眾已進入線上報案服務。' });
      if (message.error) throw message.error;
    }

    res.setHeader('Set-Cookie', createSessionCookie({ caseId: caseRow.id, citizenName, nationalId }));
    json(res, 200, { status: 'open', case: publicCase(caseRow), cases: cases.map(publicCase) });
  } catch (error) {
    json(res, 500, { error: error.message || '申請開通失敗' });
  }
};