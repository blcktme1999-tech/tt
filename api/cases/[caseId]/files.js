const { VIDEO_BUCKET, dataUrlToBuffer, getJsonBody, getSupabase, json, methodNotAllowed, publicFile, requireCaseAccess, safeName } = require('../../_lib/service');

async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return methodNotAllowed(res, ['GET', 'POST']);
  try {
    const client = getSupabase();
    const access = await requireCaseAccess(req, res, client, req.query.caseId);
    if (!access) return;
    if (access.caseRow.status !== 'open') return json(res, 400, { error: '案件尚未開通' });

    if (req.method === 'GET') {
      const result = await client.from('service_files').select('*').eq('case_id', req.query.caseId).order('created_at', { ascending: false });
      if (result.error) throw result.error;
      return json(res, 200, { files: (result.data || []).map(publicFile) });
    }

    const body = await getJsonBody(req);
    const parsed = dataUrlToBuffer(body.dataUrl);
    if (!parsed) return json(res, 400, { error: '影片格式錯誤，請重新上傳' });
    if (!parsed.mimeType.startsWith('video/')) return json(res, 400, { error: '只允許上傳影片檔' });

    const originalName = safeName(body.fileName || 'video.webm');
    const storedName = `${req.query.caseId}/${Date.now()}-${originalName}`;
    const uploaded = await client.storage.from(VIDEO_BUCKET).upload(storedName, parsed.buffer, { contentType: parsed.mimeType, upsert: false });
    if (uploaded.error) throw uploaded.error;
    const publicResult = client.storage.from(VIDEO_BUCKET).getPublicUrl(storedName);
    const publicUrl = publicResult.data?.publicUrl || '';
    const user = access.session.user;
    const uploadedBy = user?.displayName || access.session.citizenName || access.caseRow.citizen_name || '民眾';
    const inserted = await client.from('service_files').insert({
      case_id: req.query.caseId,
      uploaded_by: uploadedBy,
      original_name: originalName,
      stored_name: storedName,
      mime_type: parsed.mimeType,
      size: Number(body.size || parsed.buffer.length),
      kind: body.kind === 'recording' ? 'recording' : 'upload',
      public_url: publicUrl
    }).select('*').single();
    if (inserted.error) throw inserted.error;
    json(res, 200, { file: publicFile(inserted.data) });
  } catch (error) {
    json(res, 500, { error: error.message || '影片處理失敗' });
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false, responseLimit: false } };
