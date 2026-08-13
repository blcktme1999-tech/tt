const { getConfig, getSupabase, json, methodNotAllowed, VIDEO_BUCKET } = require('./_lib/service');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const checks = {
    env: {
      sessionSecret: false,
      supabaseUrl: false,
      supabaseServiceRoleKey: false,
      agoraAppId: false,
      agoraAppCertificate: false
    },
    tables: {},
    storage: {}
  };

  try {
    const config = getConfig();
    checks.env = {
      sessionSecret: Boolean(config.sessionSecret),
      supabaseUrl: Boolean(config.supabaseUrl),
      supabaseServiceRoleKey: Boolean(config.supabaseServiceRoleKey),
      agoraAppId: Boolean(config.agoraAppId),
      agoraAppCertificate: Boolean(config.agoraAppCertificate)
    };
    const client = getSupabase();
    const tableNames = ['service_users', 'service_cases', 'service_messages', 'service_files'];
    for (const tableName of tableNames) {
      const result = await client.from(tableName).select('id', { count: 'exact', head: true });
      checks.tables[tableName] = result.error ? { ok: false, error: result.error.message } : { ok: true };
    }
    const buckets = await client.storage.listBuckets();
    checks.storage[VIDEO_BUCKET] = buckets.error
      ? { ok: false, error: buckets.error.message }
      : { ok: (buckets.data || []).some((bucket) => bucket.name === VIDEO_BUCKET) };
    json(res, 200, { ok: true, checks });
  } catch (error) {
    json(res, 500, { ok: false, error: error.message || 'health check failed', checks });
  }
};
