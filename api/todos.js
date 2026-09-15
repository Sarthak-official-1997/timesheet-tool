'use strict';

const SUPABASE_URL = process.env.SUPABASE_URL;
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

// Owner + everyone who has joined their list, deduped — used for both
// reading the list and (in the cron) deciding who to notify.
module.exports = async (req, res) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    res.status(500).json({ error: 'Server missing SUPABASE_URL / SUPABASE_SERVICE_KEY env vars' });
    return;
  }

  try {
    if (req.method === 'GET') {
      const code = String(req.query.code || '').trim();
      if (!code) { res.status(400).json({ error: 'code is required' }); return; }
      const rows = await sbFetch(`shared_todos?owner_sync_id=eq.${encodeURIComponent(code)}&select=id,text,done,created_at&order=created_at.asc`);
      res.status(200).json({ items: rows });
      return;
    }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};

    if (req.method === 'POST') {
      const code = String(body.code || '').trim();
      const text = String(body.text || '').trim();
      if (!code || !text) { res.status(400).json({ error: 'code and text are required' }); return; }
      const rows = await sbFetch('shared_todos', {
        method: 'POST',
        body: JSON.stringify({ owner_sync_id: code, text })
      });
      res.status(200).json({ item: rows[0] });
      return;
    }

    if (req.method === 'PATCH') {
      const { code, id, done, text } = body;
      if (!code || !id) { res.status(400).json({ error: 'code and id are required' }); return; }
      const patch = { updated_at: new Date().toISOString() };
      if (typeof done === 'boolean') patch.done = done;
      if (typeof text === 'string' && text.trim()) patch.text = text.trim();
      await sbFetch(`shared_todos?id=eq.${encodeURIComponent(id)}&owner_sync_id=eq.${encodeURIComponent(code)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
        prefer: 'return=minimal'
      });
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === 'DELETE') {
      const code = String(req.query.code || body.code || '').trim();
      const id = String(req.query.id || body.id || '').trim();
      if (!code || !id) { res.status(400).json({ error: 'code and id are required' }); return; }
      await sbFetch(`shared_todos?id=eq.${encodeURIComponent(id)}&owner_sync_id=eq.${encodeURIComponent(code)}`, {
        method: 'DELETE',
        prefer: 'return=minimal'
      });
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'GET, POST, PATCH or DELETE only' });
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
};
