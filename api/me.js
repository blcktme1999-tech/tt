const { getSupabase, json, methodNotAllowed, publicCase, publicUser, readSession } = require('./_lib/service');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const client = getSupabase();
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
