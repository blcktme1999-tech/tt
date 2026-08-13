const { getSupabase, json, methodNotAllowed, publicCase, requireStaff } = require('../_lib/service');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const session = requireStaff(req, res);
    if (!session) return;
    const client = getSupabase();
    const result = await client.from('service_cases').select('*').order('created_at', { ascending: false });
    if (result.error) throw result.error;
    json(res, 200, { cases: (result.data || []).map(publicCase) });
  } catch (error) {
    json(res, 500, { error: error.message || '讀取案件失敗' });
  }
};
