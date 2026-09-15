'use strict';

const webpush = require('web-push');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:example@example.com';

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

// Manual "remind them right now" — targets one specific person's own
// subscriptions (the list owner), triggered by someone who joined their list.
module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    res.status(500).json({ error: 'Missing SUPABASE_URL / SUPABASE_SERVICE_KEY / VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const targetCode = String((body || {}).targetCode || '').trim();
  if (!targetCode) { res.status(400).json({ error: 'targetCode is required' }); return; }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  try {
    const subs = await sbFetch(`push_subscriptions?sync_id=eq.${encodeURIComponent(targetCode)}&select=*`);
    if (!subs || subs.length === 0) {
      res.status(404).json({ error: "That code doesn't have notifications set up." });
      return;
    }

    const payload = JSON.stringify({
      title: '🔔 To-do reminder',
      body: 'Someone you shared a to-do list with just nudged you to check it.',
      tag: 'todo-nudge',
      url: '/'
    });

    let sent = 0;
    for (const sub of subs) {
      const pushSub = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
      try {
        await webpush.sendNotification(pushSub, payload);
        sent++;
      } catch (err) {
        const statusCode = err && (err.statusCode || (err.response && err.response.statusCode));
        if (statusCode === 404 || statusCode === 410) {
          await sbFetch(`push_subscriptions?id=eq.${sub.id}`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => {});
        }
      }
    }

    res.status(200).json({ ok: true, sent });
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
};
