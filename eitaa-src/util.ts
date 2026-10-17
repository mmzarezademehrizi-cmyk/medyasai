// Pure helpers: escaping, Persian digits, Jalali calendar, Tehran time, schedule parsing.
export const TEHRAN_OFFSET_S = 3.5 * 3600; // Iran abolished DST in 2022: fixed UTC+03:30

export const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function normDigits(s: string): string {
  return s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

// ---- Jalali <-> Gregorian (jalaali-js algorithm)
const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
const div = (a: number, b: number) => ~~(a / b);
const mod = (a: number, b: number) => a - ~~(a / b) * b;

function jalCal(jy: number) {
  const bl = BREAKS.length, gy = jy + 621;
  let leapJ = -14, jp = BREAKS[0], jm: number, jump = 0;
  for (let i = 1; i < bl; i += 1) {
    jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy: number, gm: number, gd: number): number {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}
function d2g(jdn: number) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1, gm = mod(div(i, 153), 12) + 1, gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}
function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}
export function toJalali(gy: number, gm: number, gd: number) {
  const jdn = g2d(gy, gm, gd);
  let jy = d2g(jdn).gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(jy + 621, 3, r.march);
  let k = jdn - jdn1f, jm: number, jd: number;
  if (k >= 0) {
    if (k <= 185) { jm = 1 + div(k, 31); jd = mod(k, 31) + 1; return { jy, jm, jd }; }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  jm = 7 + div(k, 30);
  jd = mod(k, 30) + 1;
  return { jy, jm, jd };
}
export function toGregorian(jy: number, jm: number, jd: number) {
  return d2g(j2d(jy, jm, jd));
}
export function isValidJalali(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const g = toGregorian(y, m, d);
  const back = toJalali(g.gy, g.gm, g.gd);
  return back.jy === y && back.jm === m && back.jd === d;
}

// ---- Tehran local time <-> epoch seconds
export interface Local { y: number; mo: number; d: number; h: number; mi: number }
export function toLocal(epoch: number): Local {
  const t = new Date((epoch + TEHRAN_OFFSET_S) * 1000);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes() };
}
export const fromLocal = (l: Local): number => Math.floor(Date.UTC(l.y, l.mo - 1, l.d, l.h, l.mi) / 1000) - TEHRAN_OFFSET_S;

export function fmtDt(epoch: number | null | undefined): string {
  if (!epoch) return "-";
  const l = toLocal(epoch), j = toJalali(l.y, l.mo, l.d), p = (n: number) => String(n).padStart(2, "0");
  return `${j.jy}/${p(j.jm)}/${p(j.jd)} - ${p(l.h)}:${p(l.mi)}`;
}

/** `+30`, `+2 ساعت`, `18:30`, `فردا 09:00`, `پس فردا 21:00`, `1405/07/20 18:30` (Jalali) or `2026/10/12 18:30`. -> epoch seconds or null */
export function parseWhen(text: string, nowEpoch = Math.floor(Date.now() / 1000)): number | null {
  const t = normDigits(text).replace(/،/g, " ").replace(/\u200c/g, " ").replace(/\s+/g, " ").trim();
  let at: number | null = null;
  let m = t.match(/^\+ ?(\d{1,5}) ?(دقیقه|ساعت|m|h)?$/);
  if (m) {
    const n = parseInt(m[1], 10);
    at = nowEpoch + (m[2] === "ساعت" || m[2] === "h" ? n * 3600 : n * 60);
  } else if ((m = t.match(/^(امروز|فردا|پس ?فردا)? ?(\d{1,2}):(\d{2})$/))) {
    const h = parseInt(m[2], 10), mi = parseInt(m[3], 10);
    if (h > 23 || mi > 59) return null;
    const n = toLocal(nowEpoch);
    at = fromLocal({ ...n, h, mi });
    const w = m[1];
    if (w === "فردا") at += 86400;
    else if (w && w.startsWith("پس")) at += 2 * 86400;
    else if (!w && at <= nowEpoch) at += 86400;
  } else if ((m = t.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2}) (\d{1,2}):(\d{2})$/))) {
    const [y, mo, d, h, mi] = m.slice(1).map((x) => parseInt(x, 10));
    if (h > 23 || mi > 59) return null;
    let gy: number, gm: number, gd: number;
    if (y >= 1300 && y < 1700) {
      if (!isValidJalali(y, mo, d)) return null;
      ({ gy, gm, gd } = toGregorian(y, mo, d));
    } else {
      const probe = new Date(Date.UTC(y, mo - 1, d));
      if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
      [gy, gm, gd] = [y, mo, d];
    }
    at = fromLocal({ y: gy, mo: gm, d: gd, h, mi });
  } else return null;
  return at < nowEpoch + 30 ? null : at;
}

export function normalizeChatId(raw: string): string {
  const t = normDigits(raw).trim();
  if (t.includes("joinchat")) return t;
  const m = t.match(/eitaa\.com\/([^/?\s]+)/);
  return (m ? m[1] : t).replace(/^@/, "").trim();
}

export const b64 = (u: Uint8Array): string => btoa(String.fromCharCode(...u));
export const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// ---- Persian date text (used by the agent: "morning" messages and date matching)
export const JALALI_MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
export const WEEKDAYS = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"]; // index = JS getUTCDay()
export const toFa = (s: string | number): string => String(s).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[+d]);
export const pad2 = (n: number): string => String(n).padStart(2, "0");

/** "شنبه ۲۳ مهر ۱۴۰۵" for the given moment (Tehran time). */
export function jalaliLong(epoch: number): string {
  const l = toLocal(epoch), j = toJalali(l.y, l.mo, l.d);
  const wd = WEEKDAYS[new Date(Date.UTC(l.y, l.mo - 1, l.d)).getUTCDay()];
  return `${wd} ${toFa(j.jd)} ${JALALI_MONTHS[j.jm - 1]} ${toFa(j.jy)}`;
}
/** Tehran calendar day + clock as a sortable key: "2026-10-14 07:00". */
export function slotKey(epoch: number): string {
  const l = toLocal(epoch);
  return `${l.y}-${pad2(l.mo)}-${pad2(l.d)} ${pad2(l.h)}:${pad2(l.mi)}`;
}
/** Epoch of "HH:MM" on the Tehran calendar day that contains `epoch`. */
export function atTime(epoch: number, hhmm: string): number {
  const [h, mi] = hhmm.split(":").map((x) => parseInt(x, 10));
  return fromLocal({ ...toLocal(epoch), h, mi });
}

/** Does `text` mention the calendar day of `epoch`? (Jalali "۲۳ مهر" / "1405/07/23", or Gregorian "2026/10/15" / "15 October") */
export function mentionsDay(text: string, epoch: number): boolean {
  const t = normDigits(text).replace(/[‌‏‎]/g, " ").replace(/\s+/g, " ");
  const l = toLocal(epoch), j = toJalali(l.y, l.mo, l.d);
  const sep = "[/\\-.]", p = (n: number) => `0?${n}`;
  const num = new RegExp(`(?:^|\\D)(?:${j.jy}${sep}${p(j.jm)}${sep}${p(j.jd)}|${p(j.jd)}${sep}${p(j.jm)}${sep}${j.jy}|${l.y}${sep}${p(l.mo)}${sep}${p(l.d)}|${p(l.d)}${sep}${p(l.mo)}${sep}${l.y})(?:\\D|$)`);
  if (num.test(t)) return true;
  const name = new RegExp(`(?:^|\\D)${p(j.jd)} ?${JALALI_MONTHS[j.jm - 1]}(?:\\s|$|\\D)`);
  return name.test(t);
}
/** Any explicit full date (yyyy/mm/dd) that is NOT today? Used to reject yesterday's "good morning" posters. */
export function mentionsOtherDate(text: string, epoch: number): boolean {
  const t = normDigits(text);
  const re = /(?:^|\D)(1[34]\d{2}|20\d{2})[/\-.](\d{1,2})[/\-.](\d{1,2})(?:\D|$)/g;
  let m: RegExpExecArray | null, any = false;
  while ((m = re.exec(t))) {
    any = true;
    const probe = `${m[1]}/${m[2]}/${m[3]}`;
    if (mentionsDay(probe, epoch)) return false;
  }
  return any;
}
