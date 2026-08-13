const { createSessionCookie, getJsonBody, getSupabase, json, methodNotAllowed, publicCase } = require('../_lib/service');

async function handler(req, res) {
  try {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const client = getSupabase();
    const body = await getJsonBody(req);
    const citizenName = String(body.citizenName || '').trim();
    const nationalId = String(body.nationalId || '').trim().toUpperCase();
    if (citizenName.length < 2 || nationalId.length < 6) return json(res, 400, { error: '請輸入姓名與身分證/居留證號' });

    let found = await client.from('service_cases').select('*').eq('citizen_name', citizenName).eq('national_id', nationalId).limit(1);
    if (found.error) throw found.error;
    let caseRow = (found.data || [])[0] || null;

    if (!caseRow) {
      const inserted = await client.from('service_cases').insert({ citizen_name: citizenName, national_id: nationalId, status: 'pending' }).select('*').single();
      if (inserted.error) throw inserted.error;
      caseRow = inserted.data;
      const message = await client.from('service_messages').insert({ case_id: caseRow.id, sender_type: 'system', sender_name: '系統', body: '民眾已送出線上客服開通申請，等待管理員審核。' });
      if (message.error) throw message.error;
    }

    if (caseRow.status !== 'open') return json(res, 200, { status: 'pending', case: publicCase(caseRow) });

    res.setHeader('Set-Cookie', createSessionCookie({ caseId: caseRow.id, citizenName }));
    json(res, 200, { status: 'open', case: publicCase(caseRow) });
  } catch (error) {
    json(res, 500, { error: error.message || '申請開通失敗' });
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
