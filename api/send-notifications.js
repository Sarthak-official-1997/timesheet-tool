'use strict';

const webpush = require('web-push');
const { officialHolidayFor, computeMonthStats, monthKey, istNow, findNextTrip, hasLoggedDay, computeStreak, getPastWeekGaps } = require('../lib/planner-logic');

const DOW_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAILY_LOG_ACTIONS = [
  { action: 'office', title: 'Office' },
  { action: 'wfh', title: 'WFH' },
  { action: 'home', title: 'Home' }
];

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:example@example.com';

// Trip countdown fires this many days out, plus on the day itself (0).
const TRIP_COUNTDOWN_DAYS = [3, 1, 0];
// Only nag about a low in-office % once the month is mostly over.
const LOW_OFFICE_PCT_FROM_DAY = 20;
const LOW_OFFICE_PCT_TARGET = 60;

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

function parsePlannerData(row) {
  const out = {};
  const raw = row && row.data;
  if (!raw) return out;
  for (const [k, v] of Object.entries(raw)) {
    try { out[k] = typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { /* skip malformed entry */ }
  }
  return out;
}

module.exports = async (req, res) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    res.status(500).json({ error: 'Missing SUPABASE_URL / SUPABASE_SERVICE_KEY / VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars' });
    return;
  }

  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" automatically
  // when the CRON_SECRET env var is set — reject anything else so this
  // endpoint can't be triggered by a random request to its public URL.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const results = [];

  async function sendAndTrack(subRow, payload, patch) {
    const pushSub = { endpoint: subRow.endpoint, keys: { p256dh: subRow.p256dh, auth: subRow.auth } };
    try {
      await webpush.sendNotification(pushSub, JSON.stringify(payload));
      await sbFetch(`push_subscriptions?id=eq.${subRow.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
        prefer: 'return=minimal'
      });
      results.push({ endpoint: subRow.endpoint, type: payload.tag, sent: true });
    } catch (err) {
      const statusCode = err && (err.statusCode || (err.response && err.response.statusCode));
      if (statusCode === 404 || statusCode === 410) {
        await sbFetch(`push_subscriptions?id=eq.${subRow.id}`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => {});
      }
      results.push({ endpoint: subRow.endpoint, type: payload.tag, sent: false, error: String((err && err.message) || err) });
    }
  }

  try {
    const subs = await sbFetch('push_subscriptions?select=*');
    const bySync = {};
    for (const sub of subs) (bySync[sub.sync_id] = bySync[sub.sync_id] || []).push(sub);

    const today = istNow();
    const y = today.getUTCFullYear(), m = today.getUTCMonth(), d = today.getUTCDate();
    const todayDateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const curMonthKey = monthKey(y, m);
    const isSunday = today.getUTCDay() === 0;

    for (const syncId of Object.keys(bySync)) {
      const subsForSync = bySync[syncId];
      const rows = await sbFetch(`planner_sync?sync_id=eq.${encodeURIComponent(syncId)}&select=data`);
      const data = parsePlannerData(rows[0]);
      const monthData = data[`month:${curMonthKey}`] || { days: {} };
      const stats = computeMonthStats(y, m, monthData);
      const holiday = officialHolidayFor(y, m, d);
      const dd = monthData.days ? monthData.days[d] : null;
      const hasLoggedToday = hasLoggedDay(dd);
      const streak = !hasLoggedToday ? computeStreak(data, today) : 0;

      let weekGaps = [];
      let weekGapsKey = null;
      if (isSunday) {
        weekGaps = getPastWeekGaps(data, today);
        if (weekGaps.length > 0) {
          weekGapsKey = new Date(Date.UTC(y, m, d) - 6 * 86400000).toISOString().slice(0, 10);
        }
      }

      const trip = findNextTrip(data, today);
      const diffDays = trip ? Math.round((trip.dateMs - Date.UTC(y, m, d)) / 86400000) : null;
      const tripDue = trip && TRIP_COUNTDOWN_DAYS.includes(diffDays);
      const tripKey = tripDue ? `${trip.dateMs}-${trip.tag.id}-${diffDays}` : null;

      const lowOfficePct = d >= LOW_OFFICE_PCT_FROM_DAY && stats.workingDays > 0 && stats.officePercent < LOW_OFFICE_PCT_TARGET;

      for (const sub of subsForSync) {
        // Skip the "log today" nudge on Sundays — not a workday, so there's
        // nothing to log; Sunday gets the weekly catch-up notification instead.
        if (!isSunday && !hasLoggedToday && sub.last_daily_reminder_date !== todayDateStr) {
          const useStreak = streak >= 2;
          await sendAndTrack(sub, {
            title: useStreak ? `🔥 ${streak}-day streak — don't lose it` : "Log today's plan",
            body: useStreak
              ? `You've logged ${streak} workdays in a row. Log today to make it ${streak + 1}.`
              : (holiday
                ? `${holiday.name} today — mark it Office/WFH if you worked, or leave it as holiday.`
                : "You haven't logged today yet — Office, WFH, Travel, Home or Leave?"),
            tag: 'daily-log',
            url: '/',
            actions: DAILY_LOG_ACTIONS
          }, { last_daily_reminder_date: todayDateStr });
        }

        if (isSunday && weekGapsKey && sub.last_weekly_catchup_key !== weekGapsKey) {
          const list = weekGaps.map((g) => `${DOW_ABBR[new Date(g.dateMs).getUTCDay()]} ${g.d}`).join(', ');
          await sendAndTrack(sub, {
            title: `${weekGaps.length} day${weekGaps.length === 1 ? '' : 's'} still unlogged this week`,
            body: `Before the week resets: ${list}.`,
            tag: 'weekly-catchup',
            url: '/'
          }, { last_weekly_catchup_key: weekGapsKey });
        }

        if (tripDue && sub.last_trip_notif_key !== tripKey) {
          await sendAndTrack(sub, {
            title: diffDays === 0 ? `Travel day: ${trip.tag.name}` : `${diffDays} day${diffDays === 1 ? '' : 's'} to ${trip.tag.name}`,
            body: diffDays === 0 ? "It's here — safe travels!" : 'Time to plan ahead.',
            tag: 'trip-countdown',
            url: '/'
          }, { last_trip_notif_key: tripKey });
        }

        if (lowOfficePct && sub.last_low_office_month !== curMonthKey) {
          await sendAndTrack(sub, {
            title: 'In-office % is trending low',
            body: `You're at ${stats.officePercent}% in-office this month (target ${LOW_OFFICE_PCT_TARGET}%). ${Math.max(0, stats.workingDays - stats.officeDays)} working day(s) left to catch up.`,
            tag: 'low-office-pct',
            url: '/'
          }, { last_low_office_month: curMonthKey });
        }
      }
    }

    // ---------- Shared to-do reminders ----------
    // One daily nudge per person (owner and everyone who joined their list)
    // if that list has any open items — same fixed time as everything else.
    const openTodos = await sbFetch('shared_todos?done=eq.false&select=owner_sync_id');
    const openCountByOwner = {};
    for (const row of openTodos) openCountByOwner[row.owner_sync_id] = (openCountByOwner[row.owner_sync_id] || 0) + 1;

    for (const ownerCode of Object.keys(openCountByOwner)) {
      const openCount = openCountByOwner[ownerCode];
      const subscriberRows = await sbFetch(`shared_todo_subscribers?owner_sync_id=eq.${encodeURIComponent(ownerCode)}&select=subscriber_sync_id`);
      const targetCodes = [ownerCode, ...subscriberRows.map((r) => r.subscriber_sync_id)];

      for (const code of targetCodes) {
        const subsForCode = bySync[code] || [];
        for (const sub of subsForCode) {
          if (sub.last_todo_reminder_date === todayDateStr) continue;
          await sendAndTrack(sub, {
            title: `📝 ${openCount} open to-do${openCount === 1 ? '' : 's'}`,
            body: code === ownerCode
              ? `You still have ${openCount} item${openCount === 1 ? '' : 's'} on your to-do list.`
              : `The shared to-do list still has ${openCount} item${openCount === 1 ? '' : 's'} open.`,
            tag: 'todo-reminder',
            url: '/'
          }, { last_todo_reminder_date: todayDateStr });
        }
      }
    }

    res.status(200).json({ ok: true, syncsChecked: Object.keys(bySync).length, results });
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err), results });
  }
};
