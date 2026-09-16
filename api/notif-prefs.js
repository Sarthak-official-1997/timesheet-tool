'use strict';

// Strips a trailing /rest/v1(/) or slash — guards against the env var being
// saved with that suffix already on it, which would double up the request
// path (".co//rest/v1/...") and break every call with a cryptic PGRST125.
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim().replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      Prefer: opts.prefer || 'return=representation',
      ...(opts.headers || {})
    },
    body: opts.body
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${path} failed: ${res.status} ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

module.exports = async (req, res) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    res.status(500).json({ error: 'Server missing SUPABASE_URL / SUPABASE_SERVICE_KEY env vars' });
    return;
  }

  try {
    if (req.method === 'GET') {
      const syncId = String(req.query.syncId || '').trim();
      if (!syncId) { res.status(400).json({ error: 'syncId is required' }); return; }
      const rows = await sbFetch(`push_subscriptions?sync_id=eq.${encodeURIComponent(syncId)}&select=notif_prefs&limit=1`);
      res.status(200).json({ prefs: (rows && rows[0] && rows[0].notif_prefs) || {} });
      return;
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const syncId = String((body || {}).syncId || '').trim();
      const prefs = (body || {}).prefs;
      if (!syncId || !prefs || typeof prefs !== 'object') {
        res.status(400).json({ error: 'syncId and prefs are required' });
        return;
      }
      // Applies to every subscription (device) under this sync code — the
      // toggle is a per-person preference, not a per-device one.
      await sbFetch(`push_subscriptions?sync_id=eq.${encodeURIComponent(syncId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ notif_prefs: prefs }),
        prefer: 'return=minimal'
      });
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'GET or POST only' });
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
};
