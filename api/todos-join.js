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

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    res.status(500).json({ error: 'Server missing SUPABASE_URL / SUPABASE_SERVICE_KEY env vars' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const ownerCode = String((body || {}).ownerCode || '').trim();
  const subscriberCode = String((body || {}).subscriberCode || '').trim();
  if (!ownerCode || !subscriberCode) { res.status(400).json({ error: 'ownerCode and subscriberCode are required' }); return; }
  if (ownerCode === subscriberCode) { res.status(400).json({ error: "That's your own code — share a different device's code to join it." }); return; }

  try {
    // The whole point of "make sure the other user has the app" — do they
    // have at least one active push subscription under that code?
    const ownerSubs = await sbFetch(`push_subscriptions?sync_id=eq.${encodeURIComponent(ownerCode)}&select=id&limit=1`);
    const ownerHasApp = Array.isArray(ownerSubs) && ownerSubs.length > 0;

    await sbFetch('shared_todo_subscribers?on_conflict=owner_sync_id,subscriber_sync_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ owner_sync_id: ownerCode, subscriber_sync_id: subscriberCode })
    });

    res.status(200).json({ ok: true, ownerHasApp });
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
};
