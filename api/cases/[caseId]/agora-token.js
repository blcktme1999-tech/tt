const { getConfig, getSupabase, json, methodNotAllowed, requireCaseAccess } = require('../../_lib/service');
const { RtcRole, RtcTokenBuilder } = require('agora-token');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const config = getConfig();
    if (!config.agoraAppId || !config.agoraAppCertificate) return json(res, 503, { error: '尚未設定 Agora 環境變數' });
    const client = getSupabase();
    const access = await requireCaseAccess(req, res, client, req.query.caseId);
    if (!access) return;
    if (access.caseRow.status !== 'open') return json(res, 400, { error: '案件尚未審核開通，無法進入視訊筆錄' });

    const channelName = access.caseRow.national_id;
    const account = access.session.user ? `${access.session.user.role}-${access.session.user.id}` : `citizen-${access.caseRow.national_id}`;
    const token = RtcTokenBuilder.buildTokenWithUserAccount(
      config.agoraAppId,
      config.agoraAppCertificate,
      channelName,
      account,
      RtcRole.PUBLISHER,
      config.agoraTokenTtlSeconds,
      config.agoraTokenTtlSeconds
    );
    json(res, 200, { appId: config.agoraAppId, channelName, uid: account, token, expiresIn: config.agoraTokenTtlSeconds });
  } catch (error) {
    json(res, 500, { error: error.message || '建立 Agora token 失敗' });
  }
};
