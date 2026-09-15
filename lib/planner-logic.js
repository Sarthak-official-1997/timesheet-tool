'use strict';

// Server-side mirror of the day-type / stats logic in index.html.
// Kept deliberately in sync with the client by hand — if you change the
// default day type, holiday handling, or office-% formula in index.html,
// mirror the change here too, or the notification job will disagree with
// what the app itself shows.

const HOLIDAYS_UP_2026 = {
  '2026-01-01': { name: "New Year's Day", type: 'restricted' },
  '2026-01-03': { name: "Hazrat Ali's Birthday", type: 'restricted' },
  '2026-01-05': { name: 'Guru Gobind Singh Jayanti', type: 'restricted' },
  '2026-01-14': { name: 'Makar Sankranti', type: 'gazetted' },
  '2026-01-23': { name: 'Basant Panchami', type: 'gazetted' },
  '2026-01-24': { name: 'Jannayak Karpoori Thakur Jayanti', type: 'restricted' },
  '2026-01-26': { name: 'Republic Day', type: 'gazetted' },
  '2026-02-01': { name: 'Sant Ravidas Jayanti', type: 'restricted' },
  '2026-02-04': { name: 'Shab-e-Barat', type: 'restricted' },
  '2026-02-15': { name: 'Maha Shivratri', type: 'gazetted' },
  '2026-03-02': { name: 'Holika Dahan', type: 'gazetted' },
  '2026-03-04': { name: 'Holi', type: 'gazetted' },
  '2026-03-05': { name: 'Day following Holi', type: 'gazetted' },
  '2026-03-13': { name: 'Jamat-ul-Vida (Alvida)', type: 'restricted' },
  '2026-03-21': { name: 'Eid ul-Fitr', type: 'gazetted' },
  '2026-03-26': { name: 'Ram Navami', type: 'gazetted' },
  '2026-03-31': { name: 'Mahavir Jayanti', type: 'gazetted' },
  '2026-04-03': { name: 'Good Friday', type: 'gazetted' },
  '2026-04-14': { name: 'Dr. B.R. Ambedkar Jayanti', type: 'gazetted' },
  '2026-04-19': { name: 'Parshuram Jayanti', type: 'restricted' },
  '2026-05-01': { name: 'Buddha Purnima', type: 'gazetted' },
  '2026-05-27': { name: 'Eid ul-Adha (Bakrid)', type: 'gazetted' },
  '2026-06-25': { name: 'Muharram', type: 'gazetted' },
  '2026-08-15': { name: 'Independence Day', type: 'gazetted' },
  '2026-08-26': { name: 'Eid-e-Milad (Barawafat)', type: 'gazetted' },
  '2026-08-28': { name: 'Raksha Bandhan', type: 'gazetted' },
  '2026-09-04': { name: 'Janmashtami', type: 'gazetted' },
  '2026-09-17': { name: 'Vishwakarma Puja', type: 'restricted' },
  '2026-10-02': { name: 'Gandhi Jayanti', type: 'gazetted' },
  '2026-10-19': { name: 'Dussehra (Maha Ashtami)', type: 'gazetted' },
  '2026-10-20': { name: 'Vijayadashami', type: 'gazetted' },
  '2026-10-26': { name: 'Valmiki Jayanti / Patel Jayanti', type: 'gazetted' },
  '2026-11-08': { name: 'Deepawali', type: 'gazetted' },
  '2026-11-09': { name: 'Govardhan Puja', type: 'gazetted' },
  '2026-11-11': { name: 'Bhaiya Dooj / Chitragupt Jayanti', type: 'gazetted' },
  '2026-11-15': { name: 'Chhath Puja', type: 'gazetted' },
  '2026-11-24': { name: 'Guru Nanak Jayanti', type: 'gazetted' },
  '2026-12-23': { name: 'Chaudhary Charan Singh Jayanti', type: 'restricted' },
  '2026-12-25': { name: 'Christmas Day', type: 'gazetted' }
};

function pad(n) { return String(n).padStart(2, '0'); }
function dateKey(y, m, day) { return `${y}-${pad(m + 1)}-${pad(day)}`; }
function monthKey(y, m) { return `${y}-${pad(m + 1)}`; }
function officialHolidayFor(y, m, day) { return HOLIDAYS_UP_2026[dateKey(y, m, day)] || null; }

function effectiveDayType(y, m, day, dayData, holiday) {
  if (dayData && dayData.dayType) return dayData.dayType;
  const dow = new Date(Date.UTC(y, m, day)).getUTCDay();
  const isWeekend = (dow === 0 || dow === 6);
  if (isWeekend) return null;
  if (holiday && holiday.type === 'gazetted') return null;
  return 'wfh';
}

function computeMonthStats(y, m, monthData) {
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  let weekdayCount = 0, officialHolOnWeekday = 0, leaveOnWeekday = 0, officeDays = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const dow = new Date(Date.UTC(y, m, day)).getUTCDay();
    const isWeekend = (dow === 0 || dow === 6);
    if (!isWeekend) weekdayCount++;
    const holiday = officialHolidayFor(y, m, day);
    const dd = monthData.days ? monthData.days[day] : null;
    const explicit = dd && dd.dayType;
    const effective = effectiveDayType(y, m, day, dd, holiday);
    const isGazetted = holiday && holiday.type === 'gazetted';
    const workedThroughHoliday = explicit === 'office' || explicit === 'wfh';

    if (!isWeekend) {
      if (isGazetted && !workedThroughHoliday) officialHolOnWeekday++;
      else if (!isGazetted && explicit === 'leave') leaveOnWeekday++;
    }
    if (effective === 'office') officeDays++;
  }
  const workingDays = Math.max(0, weekdayCount - officialHolOnWeekday - leaveOnWeekday);
  const officePercent = workingDays > 0 ? Math.round((officeDays / workingDays) * 100) : 0;
  return { workingDays, officeDays, officePercent, daysInMonth };
}

// Server runs in UTC; shift by IST's fixed +5:30 offset so date-field
// getters (getUTCFullYear/Month/Date) read as if they were local IST.
function istNow() {
  const now = new Date();
  return new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
}

function hasLoggedDay(dd) {
  return !!(dd && (dd.dayType || dd.travel || (dd.notes && dd.notes.trim() !== '') || dd.tag));
}

// Consecutive workdays immediately before today that are logged — weekends
// and gazetted holidays are skipped over (they neither break nor extend the
// streak), any other unlogged workday stops the count.
function computeStreak(dataObj, istToday) {
  let y = istToday.getUTCFullYear(), m = istToday.getUTCMonth(), d = istToday.getUTCDate();
  let streak = 0;
  for (let i = 0; i < 60; i++) {
    const dt = new Date(Date.UTC(y, m, d) - 86400000);
    y = dt.getUTCFullYear(); m = dt.getUTCMonth(); d = dt.getUTCDate();
    const dow = dt.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const holiday = officialHolidayFor(y, m, d);
    if (holiday && holiday.type === 'gazetted') continue;
    const monthData = dataObj[`month:${monthKey(y, m)}`];
    const dd = monthData && monthData.days ? monthData.days[d] : null;
    if (hasLoggedDay(dd)) streak++;
    else break;
  }
  return streak;
}

// Unlogged Mon-Fri of the week ending on the Saturday just before istToday —
// meant to be called with istToday being that week's Sunday.
function getPastWeekGaps(dataObj, istToday) {
  const y0 = istToday.getUTCFullYear(), m0 = istToday.getUTCMonth(), d0 = istToday.getUTCDate();
  const sundayMs = Date.UTC(y0, m0, d0);
  const gaps = [];
  for (let offset = 6; offset >= 2; offset--) {
    const dt = new Date(sundayMs - offset * 86400000);
    const y = dt.getUTCFullYear(), m = dt.getUTCMonth(), d = dt.getUTCDate();
    const holiday = officialHolidayFor(y, m, d);
    if (holiday && holiday.type === 'gazetted') continue;
    const monthData = dataObj[`month:${monthKey(y, m)}`];
    const dd = monthData && monthData.days ? monthData.days[d] : null;
    if (!hasLoggedDay(dd)) gaps.push({ y, m, d, dateMs: dt.getTime() });
  }
  return gaps;
}

const TRAVEL_COLOR = '#9a7fc4';

function findNextTrip(dataObj, istToday) {
  const tags = dataObj.tags || [];
  const tagById = (id) => tags.find((t) => t.id === id);
  const y0 = istToday.getUTCFullYear(), m0 = istToday.getUTCMonth(), d0 = istToday.getUTCDate();
  const todayZero = Date.UTC(y0, m0, d0);
  let searchY = y0, searchM = m0;
  for (let i = 0; i < 15; i++) {
    const key = `month:${monthKey(searchY, searchM)}`;
    const monthData = dataObj[key];
    if (monthData && monthData.days) {
      const daysInMonth = new Date(Date.UTC(searchY, searchM + 1, 0)).getUTCDate();
      for (let day = 1; day <= daysInMonth; day++) {
        const dd = monthData.days[day];
        // A trip candidate is any day with a city tag, OR any day flagged
        // Travel (even with no tag) — mirrors the client's countdown logic.
        if (dd && (dd.tag || dd.travel)) {
          const dateMs = Date.UTC(searchY, searchM, day);
          if (dateMs >= todayZero) {
            const tag = dd.tag ? tagById(dd.tag) : null;
            if (tag) return { dateMs, tag, day };
            if (dd.travel) return { dateMs, tag: { name: 'Travel', color: TRAVEL_COLOR }, day };
          }
        }
      }
    }
    searchM++;
    if (searchM > 11) { searchM = 0; searchY++; }
  }
  return null;
}

module.exports = {
  HOLIDAYS_UP_2026,
  officialHolidayFor,
  effectiveDayType,
  computeMonthStats,
  monthKey,
  istNow,
  findNextTrip,
  hasLoggedDay,
  computeStreak,
  getPastWeekGaps
};
