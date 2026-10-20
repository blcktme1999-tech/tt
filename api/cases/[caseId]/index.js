const { VIDEO_BUCKET, getSupabase, json, methodNotAllowed, requireStaff, serviceErrorMessage } = require('../../_lib/service');

async function handler(req, res) {
  if (req.method !== 'DELETE') return methodNotAllowed(res, ['DELETE']);
  try {
    const session = requireStaff(req, res);
    if (!session) return;
    const client = getSupabase();
    const existing = await client.from('service_cases').select('id').eq('id', req.query.caseId).maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) return json(res, 404, { error: '找不到案件' });

    const files = await client.from('service_files').select('stored_name').eq('case_id', req.query.caseId);
    if (files.error) throw files.error;
    const names = (files.data || []).map((file) => file.stored_name).filter(Boolean);
    if (names.length) await client.storage.from(VIDEO_BUCKET).remove(names);

    const deleted = await client.from('service_cases').delete().eq('id', req.query.caseId);
    if (deleted.error) throw deleted.error;
    json(res, 200, { ok: true });
  } catch (error) {
    json(res, 500, { error: serviceErrorMessage(error, '刪除案件失敗') });
  }
}

module.exports = handler;
