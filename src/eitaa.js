// eitaa-src/util.ts
var TEHRAN_OFFSET_S = 3.5 * 3600;
var esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function normDigits(s) {
  return s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));
}
var BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
var div = (a, b) => ~~(a / b);
var mod = (a, b) => a - ~~(a / b) * b;
function jalCal(jy) {
  const bl = BREAKS.length, gy = jy + 621;
  let leapJ = -14, jp = BREAKS[0], jm, jump = 0;
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
function g2d(gy, gm, gd) {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}
function d2g(jdn) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1, gm = mod(div(i, 153), 12) + 1, gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}
function j2d(jy, jm, jd) {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}
function toJalali(gy, gm, gd) {
  const jdn = g2d(gy, gm, gd);
  let jy = d2g(jdn).gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(jy + 621, 3, r.march);
  let k = jdn - jdn1f, jm, jd;
  if (k >= 0) {
    if (k <= 185) {
      jm = 1 + div(k, 31);
      jd = mod(k, 31) + 1;
      return { jy, jm, jd };
    }
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
function toGregorian(jy, jm, jd) {
  return d2g(j2d(jy, jm, jd));
}
function isValidJalali(y, m, d) {
  if (m < 1 || m > 12 || d < 1) return false;
  const g = toGregorian(y, m, d);
  const back = toJalali(g.gy, g.gm, g.gd);
  return back.jy === y && back.jm === m && back.jd === d;
}
function toLocal(epoch) {
  const t = new Date((epoch + TEHRAN_OFFSET_S) * 1e3);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes() };
}
var fromLocal = (l) => Math.floor(Date.UTC(l.y, l.mo - 1, l.d, l.h, l.mi) / 1e3) - TEHRAN_OFFSET_S;
function fmtDt(epoch) {
  if (!epoch) return "-";
  const l = toLocal(epoch), j = toJalali(l.y, l.mo, l.d), p = (n) => String(n).padStart(2, "0");
  return `${j.jy}/${p(j.jm)}/${p(j.jd)} - ${p(l.h)}:${p(l.mi)}`;
}
function parseWhen(text, nowEpoch = Math.floor(Date.now() / 1e3)) {
  const t = normDigits(text).replace(/،/g, " ").replace(/\u200c/g, " ").replace(/\s+/g, " ").trim();
  let at = null;
  let m = t.match(/^\+ ?(\d{1,5}) ?(دقیقه|ساعت|m|h)?$/);
  if (m) {
    const n = parseInt(m[1], 10);
    at = nowEpoch + (m[2] === "\u0633\u0627\u0639\u062A" || m[2] === "h" ? n * 3600 : n * 60);
  } else if (m = t.match(/^(امروز|فردا|پس ?فردا)? ?(\d{1,2}):(\d{2})$/)) {
    const h = parseInt(m[2], 10), mi = parseInt(m[3], 10);
    if (h > 23 || mi > 59) return null;
    const n = toLocal(nowEpoch);
    at = fromLocal({ ...n, h, mi });
    const w = m[1];
    if (w === "\u0641\u0631\u062F\u0627") at += 86400;
    else if (w && w.startsWith("\u067E\u0633")) at += 2 * 86400;
    else if (!w && at <= nowEpoch) at += 86400;
  } else if (m = t.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2}) (\d{1,2}):(\d{2})$/)) {
    const [y, mo, d, h, mi] = m.slice(1).map((x) => parseInt(x, 10));
    if (h > 23 || mi > 59) return null;
    let gy, gm, gd;
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
function normalizeChatId(raw) {
  const t = normDigits(raw).trim();
  if (t.includes("joinchat")) return t;
  const m = t.match(/eitaa\.com\/([^/?\s]+)/);
  return (m ? m[1] : t).replace(/^@/, "").trim();
}
var b64 = (u) => btoa(String.fromCharCode(...u));
var unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
var JALALI_MONTHS = ["\u0641\u0631\u0648\u0631\u062F\u06CC\u0646", "\u0627\u0631\u062F\u06CC\u0628\u0647\u0634\u062A", "\u062E\u0631\u062F\u0627\u062F", "\u062A\u06CC\u0631", "\u0645\u0631\u062F\u0627\u062F", "\u0634\u0647\u0631\u06CC\u0648\u0631", "\u0645\u0647\u0631", "\u0622\u0628\u0627\u0646", "\u0622\u0630\u0631", "\u062F\u06CC", "\u0628\u0647\u0645\u0646", "\u0627\u0633\u0641\u0646\u062F"];
var WEEKDAYS = ["\u06CC\u06A9\u0634\u0646\u0628\u0647", "\u062F\u0648\u0634\u0646\u0628\u0647", "\u0633\u0647\u200C\u0634\u0646\u0628\u0647", "\u0686\u0647\u0627\u0631\u0634\u0646\u0628\u0647", "\u067E\u0646\u062C\u0634\u0646\u0628\u0647", "\u062C\u0645\u0639\u0647", "\u0634\u0646\u0628\u0647"];
var toFa = (s) => String(s).replace(/\d/g, (d) => "\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9"[+d]);
var pad2 = (n) => String(n).padStart(2, "0");
function jalaliLong(epoch) {
  const l = toLocal(epoch), j = toJalali(l.y, l.mo, l.d);
  const wd = WEEKDAYS[new Date(Date.UTC(l.y, l.mo - 1, l.d)).getUTCDay()];
  return `${wd} ${toFa(j.jd)} ${JALALI_MONTHS[j.jm - 1]} ${toFa(j.jy)}`;
}
function slotKey(epoch) {
  const l = toLocal(epoch);
  return `${l.y}-${pad2(l.mo)}-${pad2(l.d)} ${pad2(l.h)}:${pad2(l.mi)}`;
}
function atTime(epoch, hhmm) {
  const [h, mi] = hhmm.split(":").map((x) => parseInt(x, 10));
  return fromLocal({ ...toLocal(epoch), h, mi });
}
function mentionsDay(text, epoch) {
  const t = normDigits(text).replace(/[‌‏‎]/g, " ").replace(/\s+/g, " ");
  const l = toLocal(epoch), j = toJalali(l.y, l.mo, l.d);
  const sep = "[/\\-.]", p = (n) => `0?${n}`;
  const num = new RegExp(`(?:^|\\D)(?:${j.jy}${sep}${p(j.jm)}${sep}${p(j.jd)}|${p(j.jd)}${sep}${p(j.jm)}${sep}${j.jy}|${l.y}${sep}${p(l.mo)}${sep}${p(l.d)}|${p(l.d)}${sep}${p(l.mo)}${sep}${l.y})(?:\\D|$)`);
  if (num.test(t)) return true;
  const name = new RegExp(`(?:^|\\D)${p(j.jd)} ?${JALALI_MONTHS[j.jm - 1]}(?:\\s|$|\\D)`);
  return name.test(t);
}
function mentionsOtherDate(text, epoch) {
  const t = normDigits(text);
  const re = /(?:^|\D)(1[34]\d{2}|20\d{2})[/\-.](\d{1,2})[/\-.](\d{1,2})(?:\D|$)/g;
  let m, any = false;
  while (m = re.exec(t)) {
    any = true;
    const probe = `${m[1]}/${m[2]}/${m[3]}`;
    if (mentionsDay(probe, epoch)) return false;
  }
  return any;
}

// eitaa-src/crypto.ts
async function key(secret) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", h, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function enc(secret, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secret), new TextEncoder().encode(plain)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return b64(out);
}
async function dec(secret, blob) {
  if (!blob) return "";
  try {
    const raw = unb64(blob);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await key(secret), raw.slice(12));
    return new TextDecoder().decode(pt);
  } catch {
    return "";
  }
}

// eitaa-src/db.ts
var now = () => Math.floor(Date.now() / 1e3);
async function getSession(env, uid) {
  const r = await env.DB.prepare("SELECT state, data FROM ea_sessions WHERE user_id=?").bind(uid).first();
  if (!r) return { state: "", data: {} };
  try {
    return { state: r.state, data: JSON.parse(r.data) };
  } catch {
    return { state: r.state, data: {} };
  }
}
async function setSession(env, uid, state, data = {}) {
  await env.DB.prepare("INSERT INTO ea_sessions(user_id,state,data,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET state=excluded.state,data=excluded.data,updated_at=excluded.updated_at").bind(uid, state, JSON.stringify(data), now()).run();
}
var clearSession = (env, uid) => setSession(env, uid, "", {});
async function touchUser(env, id, name, username) {
  await env.DB.prepare("INSERT INTO ea_users(id,name,username,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, username=excluded.username").bind(id, name.slice(0, 100), (username || "").slice(0, 64), now()).run();
  return await env.DB.prepare("SELECT * FROM ea_users WHERE id=?").bind(id).first();
}
var getUser = (env, id) => env.DB.prepare("SELECT * FROM ea_users WHERE id=?").bind(id).first();
var getChannel = (env, id) => env.DB.prepare("SELECT * FROM ea_channels WHERE id=?").bind(id).first();
var userChannels = async (env, uid) => (await env.DB.prepare("SELECT * FROM ea_channels WHERE user_id=? ORDER BY id").bind(uid).all()).results;
var getJob = (env, id) => env.DB.prepare("SELECT * FROM agent_jobs WHERE id=?").bind(id).first();
var userJobs = async (env, uid) => (await env.DB.prepare("SELECT * FROM agent_jobs WHERE user_id=? ORDER BY id").bind(uid).all()).results;

// eitaa-src/env.ts
var tgBase = (e) => (e.TG_API_BASE || "https://api.telegram.org").replace(/\/$/, "");
var eitaaBase = (e) => (e.EITAA_API_BASE || "https://eitaayar.ir/api").replace(/\/$/, "");
var eitaaWeb = (e) => (e.EITAA_WEB_BASE || "https://eitaa.com").replace(/\/$/, "");
var adminIds = (e) => (e.ADMIN_IDS || "").split(/[,\s]+/).filter((x) => /^\d+$/.test(x)).map(Number);

// eitaa-src/eitaa.ts
var EitaaError = class extends Error {
};
var EitaaNetworkError = class extends EitaaError {
};
function eitaaUrl(env, token, method) {
  const base = eitaaBase(env).replace(/\/+$/, "").replace(/\/bot$/i, "");
  const t = token.trim().replace(/^bot/i, "");
  return `${base}/bot${t}/${method}`;
}
async function call(env, token, method, form) {
  const raw = token.trim().replace(/^bot/i, "");
  const clean = (m) => m.split(raw).join("***").split(token).join("***");
  let r;
  try {
    r = await fetch(eitaaUrl(env, token, method), { method: "POST", body: form });
  } catch (e) {
    throw new EitaaNetworkError(clean(`${e.name}: ${e.message}`));
  }
  let j;
  try {
    j = await r.json();
  } catch {
    throw new EitaaError(`\u067E\u0627\u0633\u062E \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0632 \u0627\u06CC\u062A\u0627\u06CC\u0627\u0631 (HTTP ${r.status})`);
  }
  if (!j || typeof j !== "object" || !j.ok) {
    throw new EitaaError(clean(String(j && (j.description || j.message || j.error) || `HTTP ${r.status}`)));
  }
  return j.result ?? j;
}
function opts(form, o) {
  if (o.title) form.set("title", o.title);
  if (o.silent) form.set("disable_notification", "1");
  if (o.pin) form.set("pin", "1");
  if (o.viewDelete) form.set("viewCountForDelete", String(o.viewDelete));
}
var getMe = (env, token) => call(env, token, "getMe", new FormData());
function sendMessage(env, token, chatId, text, o = {}) {
  const f = new FormData();
  f.set("chat_id", chatId);
  f.set("text", text);
  opts(f, o);
  return call(env, token, "sendMessage", f);
}
function sendFile(env, token, chatId, name, bytes, caption, o = {}) {
  const f = new FormData();
  f.set("chat_id", chatId);
  if (caption) f.set("caption", caption);
  opts(f, o);
  f.set("file", new Blob([bytes.slice().buffer]), name);
  return call(env, token, "sendFile", f).catch((e) => {
    if (e instanceof EitaaNetworkError || !/method|not\s*found|unknown|invalid/i.test(e.message)) throw e;
    return call(env, token, "sendDocument", f);
  });
}
var GENERIC = /* @__PURE__ */ new Set(["", "eitaa", "\u0627\u06CC\u062A\u0627", "\u067E\u06CC\u0627\u0645 \u0631\u0633\u0627\u0646 \u0627\u06CC\u062A\u0627", "\u067E\u06CC\u0627\u0645\u200C\u0631\u0633\u0627\u0646 \u0627\u06CC\u062A\u0627", "eitaa messenger"]);
var unesc = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
function meta(page, prop) {
  for (const re of [
    new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, "i")
  ]) {
    const m = page.match(re);
    if (m) return unesc(m[1]).trim();
  }
  return "";
}
function parseChatPage(page, isInvite) {
  let title = meta(page, "og:title");
  if (!title) {
    const m = page.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    title = m ? unesc(m[1]).trim() : "";
  }
  title = title.split(/\s[-–|]\s*(?:Eitaa|ایتا)\s*$/i)[0].trim();
  const desc = meta(page, "og:description") || meta(page, "description");
  if (GENERIC.has(title.toLowerCase())) return { exists: false, kind: "unknown", title: "", desc: "" };
  const text = page.replace(/<[^>]+>/g, " "), low = text.toLowerCase();
  const kind = text.includes("\u0645\u0634\u062A\u0631\u06A9") || low.includes("subscriber") || low.includes("followers") ? "channel" : text.includes("\u0639\u0636\u0648") || low.includes("members") ? "group" : isInvite ? "private" : "unknown";
  return { exists: true, kind, title: title.slice(0, 100), desc: desc.slice(0, 200) };
}
async function lookupChat(env, chatId) {
  const none = { exists: null, kind: "unknown", title: "", desc: "" };
  const cid = chatId.trim(), invite = cid.includes("joinchat");
  let url;
  if (invite) url = `${eitaaWeb(env)}/joinchat/${cid.replace(/\/$/, "").split("joinchat/").pop().split("?")[0]}`;
  else if (/^[A-Za-z0-9_.]{3,64}$/.test(cid) && !/^\d+$/.test(cid)) url = `${eitaaWeb(env)}/${cid}`;
  else return none;
  try {
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, redirect: "follow" });
    if (r.status === 404) return { ...none, exists: false };
    if (r.status !== 200) return none;
    return parseChatPage(await r.text(), invite);
  } catch {
    return none;
  }
}

// eitaa-src/providers.ts
var MODELS = [
  { model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", name: "Llama 3.3 70B" },
  { model: "@cf/mistralai/mistral-small-3.1-24b-instruct", name: "Mistral Small 3.1" },
  { model: "@cf/meta/llama-3.1-8b-instruct", name: "Llama 3.1 8B" }
];
var AI;
var getAi = () => AI;
var envOf = (env, name) => (env[name] || "").trim();
var cache = null;
async function cools(env) {
  if (cache && Date.now() - cache.at < 15e3) return cache.map;
  const rows = (await env.DB.prepare("SELECT key, value FROM settings WHERE key LIKE 'ea_cool:%'").all()).results;
  cache = { at: Date.now(), map: new Map(rows.map((r) => [r.key, r.value])) };
  return cache.map;
}
async function llmChain(env) {
  AI = env.AI;
  if (envOf(env, "LLM_TEST_BASE")) return [{ id: "test", name: "test", model: "test-model", base: envOf(env, "LLM_TEST_BASE"), key: envOf(env, "LLM_TEST_KEY"), json: true }];
  if (!env.AI) return [];
  const extra = env.EA_MODEL ? [{ model: env.EA_MODEL, name: "AI" }] : [];
  const m = await cools(env), t = Math.floor(Date.now() / 1e3);
  const cool = (id) => parseInt(m.get(`ea_cool:${id}`) || "0", 10) > t;
  return [...extra, ...MODELS.filter((x) => x.model !== env.EA_MODEL)].map((x) => ({ id: x.model, name: x.name, model: x.model, json: false })).sort((a, b) => Number(cool(a.id)) - Number(cool(b.id)));
}
var llmReady = async (env) => (await llmChain(env)).length > 0;
async function markCooldown(env, id, seconds) {
  await env.DB.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(`ea_cool:${id}`, String(Math.floor(Date.now() / 1e3) + seconds)).run();
  cache = null;
}

// eitaa-src/llm.ts
function httpReason(status) {
  if (status === 401 || status === 403) return "\u06A9\u0644\u06CC\u062F API \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A \u06CC\u0627 \u062F\u0633\u062A\u0631\u0633\u06CC \u0646\u062F\u0627\u0631\u062F";
  if (status === 402) return "\u0645\u0648\u062C\u0648\u062F\u06CC/\u0627\u0639\u062A\u0628\u0627\u0631 \u062D\u0633\u0627\u0628 \u062A\u0645\u0627\u0645 \u0634\u062F\u0647 \u0627\u0633\u062A";
  if (status === 404) return "\u0645\u062F\u0644 \u06CC\u0627 \u0622\u062F\u0631\u0633 API \u067E\u06CC\u062F\u0627 \u0646\u0634\u062F (\u0646\u0627\u0645 \u0645\u062F\u0644 \u0631\u0627 \u0628\u0631\u0631\u0633\u06CC \u06A9\u0646\u06CC\u062F)";
  if (status === 429) return "\u0633\u0647\u0645\u06CC\u0647 \u06CC\u0627 \u0645\u062D\u062F\u0648\u062F\u06CC\u062A \u062A\u0639\u062F\u0627\u062F \u062F\u0631\u062E\u0648\u0627\u0633\u062A \u067E\u0631 \u0634\u062F\u0647 \u0627\u0633\u062A";
  if (status >= 500) return "\u0633\u0631\u0648\u06CC\u0633 \u0645\u0648\u0642\u062A\u0627\u064B \u062F\u0631 \u062F\u0633\u062A\u0631\u0633 \u0646\u06CC\u0633\u062A";
  return `\u062E\u0637\u0627\u06CC HTTP ${status}`;
}
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function viaBinding(cfg, body) {
  const ai = getAi();
  if (!ai) throw new Error("\u0627\u062A\u0635\u0627\u0644 Workers AI (binding) \u0641\u0639\u0627\u0644 \u0646\u06CC\u0633\u062A");
  const msgs = body.messages.map((m) => m.tool_calls ? { role: "assistant", content: m.content || "", tool_calls: m.tool_calls.map((c) => ({ id: c.id, type: "function", function: { name: c.function.name, arguments: c.function.arguments } })) } : m);
  let r;
  try {
    r = await ai.run(cfg.model, { messages: msgs, max_tokens: body.max_tokens, temperature: body.temperature, ...body.tools ? { tools: body.tools.map((t) => t.function) } : {} });
  } catch (e) {
    const t = String(e.message || e);
    throw Object.assign(new Error(/limit|quota|neurons|capacity|4006|allocation/i.test(t) ? httpReason(429) : `Workers AI: ${t.slice(0, 120)}`), /limit|quota|neurons|capacity|4006|allocation/i.test(t) ? { status: 429 } : {});
  }
  if (r?.choices?.[0]?.message) return r;
  const calls = (r?.tool_calls || []).map((c, i) => ({ id: `cf_${Date.now().toString(36)}_${i}`, type: "function", function: { name: c.name, arguments: typeof c.arguments === "string" ? c.arguments : JSON.stringify(c.arguments || {}) } }));
  return { choices: [{ message: { role: "assistant", content: typeof r?.response === "string" ? r.response.replace(/<think>[\s\S]*?<\/think>/gi, "").trim() : null, ...calls.length ? { tool_calls: calls } : {} } }] };
}
async function callOne(cfg, body, timeoutMs = 45e3) {
  if (!cfg.base) return viaBinding(cfg, body);
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(`${cfg.base}/chat/completions`, {
        method: "POST",
        signal: ctl.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` },
        body: JSON.stringify({ model: cfg.model, ...body })
      });
      if (!r.ok) {
        console.error("llm http", cfg.id, r.status);
        if ((r.status === 429 || r.status >= 500) && attempt === 0) {
          await sleep(4e3);
          continue;
        }
        throw Object.assign(new Error(httpReason(r.status)), { status: r.status });
      }
      const j = await r.json();
      if (j?.error) throw new Error(String(j.error.message || "\u062E\u0637\u0627\u06CC \u0646\u0627\u0645\u0634\u062E\u0635 \u0627\u0632 \u0633\u0631\u0648\u06CC\u0633").slice(0, 160));
      return j;
    } catch (e) {
      if (e.name === "AbortError") {
        if (attempt === 0 && timeoutMs >= 3e4) continue;
        throw new Error("\u067E\u0627\u0633\u062E \u0646\u062F\u0627\u062F (timeout)");
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("\u067E\u0627\u0633\u062E \u0646\u062F\u0627\u062F");
}
async function viaChain(env, fn) {
  const chain = await llmChain(env);
  if (!chain.length) throw new Error("\u0647\u0646\u0648\u0632 \u0647\u06CC\u0686 \u0633\u0631\u0648\u06CC\u0633 \u0647\u0648\u0634 \u0645\u0635\u0646\u0648\u0639\u06CC \u062A\u0646\u0638\u06CC\u0645 \u0646\u0634\u062F\u0647 \u0627\u0633\u062A");
  const errs = [];
  for (const cfg of chain) {
    try {
      return await fn(cfg);
    } catch (e) {
      errs.push(`${cfg.name}: ${e.message}`);
      const st = e.status;
      if (st === 429) await markCooldown(env, cfg.id, 10 * 60).catch(() => {
      });
      else if (st === 402 || st === 401 || st === 403) await markCooldown(env, cfg.id, 30 * 60).catch(() => {
      });
      else if (st && st >= 500) await markCooldown(env, cfg.id, 2 * 60).catch(() => {
      });
    }
  }
  throw new Error(errs.join(" | "));
}
function chatJson(env, system, user, maxTokens = 1500) {
  return viaChain(env, async (cfg) => {
    const j = await callOne(cfg, {
      temperature: 0.2,
      max_tokens: maxTokens,
      ...cfg.json ? { response_format: { type: "json_object" } } : {},
      messages: [{ role: "system", content: system + "\nReply with a single JSON object and nothing else." }, { role: "user", content: user }]
    });
    const content = j?.choices?.[0]?.message?.content || "";
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("\u067E\u0627\u0633\u062E \u0642\u0627\u0628\u0644\u200C\u0641\u0647\u0645 \u0646\u0628\u0648\u062F");
    try {
      return JSON.parse(m[0]);
    } catch {
      throw new Error("\u067E\u0627\u0633\u062E \u0642\u0627\u0628\u0644\u200C\u0641\u0647\u0645 \u0646\u0628\u0648\u062F");
    }
  });
}
function chatTools(env, messages, tools, timeoutMs = 45e3, maxTokens = 900) {
  return viaChain(env, async (cfg) => {
    const msgs = messages;
    const j = await callOne(cfg, { temperature: 0.3, max_tokens: maxTokens, messages: msgs, tools, tool_choice: "auto" }, timeoutMs);
    const m = j?.choices?.[0]?.message;
    if (!m) throw new Error("\u067E\u0627\u0633\u062E \u0646\u0627\u0645\u0639\u062A\u0628\u0631");
    const calls = (m.tool_calls || []).map((c, i) => ({ ...c, id: c.id || `call_${Date.now().toString(36)}_${i}`, type: "function" }));
    return { role: "assistant", content: m.content ?? null, ...calls.length ? { tool_calls: calls } : {} };
  });
}

// eitaa-src/source.ts
var ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "\xAB", raquo: "\xBB", hellip: "\u2026", zwnj: "\u200C" };
var unescapeHtml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") {
    const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    try {
      return String.fromCodePoint(n);
    } catch {
      return m;
    }
  }
  return ENT[e.toLowerCase()] ?? m;
});
function htmlToText(html) {
  const t = unescapeHtml(html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li)>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return t.trim();
}
var escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var norm = (s) => normDigits(s).replace(/ي/g, "\u06CC").replace(/ك/g, "\u06A9").replace(/[ً-ٟـ‌‏‎]/g, "").toLowerCase();
function parseMessages(html, source, base) {
  const marks = [];
  const re = /data-post=["']([^"']+)["']/g;
  let m;
  while (m = re.exec(html)) marks.push({ at: m.index, id: m[1] });
  const out = [];
  const abs = (u) => {
    try {
      return new URL(unescapeHtml(u), base + "/").toString();
    } catch {
      return "";
    }
  };
  for (let i = 0; i < marks.length; i++) {
    const block = html.slice(marks[i].at, i + 1 < marks.length ? marks[i + 1].at : html.length);
    if (/service_message/.test(block.slice(0, 400))) continue;
    const id = marks[i].id.split("/").pop() || "";
    if (!/^\d+$/.test(id)) continue;
    let text = "";
    const tre = /<div[^>]+class=["']([^"']*_widget_message_text[^"']*)["'][^>]*>([\s\S]*?)<\/div>/gi;
    let tm;
    while (tm = tre.exec(block)) if (!/reply/.test(tm[1])) text = htmlToText(tm[2]);
    const dt = block.match(/<time[^>]+datetime=["']([^"']+)["']/i);
    const ts = dt && !isNaN(Date.parse(dt[1])) ? Math.floor(Date.parse(dt[1]) / 1e3) : null;
    let image = "";
    const pm = block.match(/class=["'][^"']*photo_wrap[^"']*["'][^>]*background-image:\s*url\(\s*['"&quot;]*([^'")]+?)['"&quot;]*\s*\)/i) || block.match(/background-image:\s*url\(\s*['"&quot;]*([^'")]+?)['"&quot;]*\s*\)[^>]*class=["'][^"']*photo_wrap/i) || block.match(/<img[^>]+class=["'][^"']*photo[^"']*["'][^>]+src=["']([^"']+)["']/i);
    if (pm) image = abs(pm[1]);
    let sticker = false;
    if (!image) {
      const wp = block.match(/data-webp=["']([^"']+)["']/i);
      let su = wp ? wp[1] : "";
      if (!su) for (const tag of block.matchAll(/<[^>]+class=["'][^"']*_sticker[^"']*["'][^>]*>/gi)) {
        const bg = tag[0].match(/background-image:\s*url\(\s*['"&quot;]*([^'")]+?)['"&quot;]*\s*\)/i) || tag[0].match(/(?:src|data-src)=["']([^"']+\.webp[^"']*)["']/i);
        if (bg) {
          su = bg[1];
          break;
        }
      }
      if (su) {
        image = abs(su);
        sticker = true;
      }
    }
    const video = /_widget_message_video|<video[\s>]/i.test(block);
    if (!text && !image) continue;
    out.push({ source, id, text, ts, image, video, sticker });
  }
  return out;
}
function pageTitle(html) {
  const mt = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i) || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return mt ? unescapeHtml(mt[1]).replace(/\s[-–|]\s*(?:Eitaa|ایتا)\s*$/i, "").trim().slice(0, 100) : "";
}
async function getPage(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15e3);
  try {
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; MedyasBot/1.0)", "accept-language": "fa,en;q=0.8" }, redirect: "follow", signal: ctl.signal });
    return { status: r.status, html: r.status === 200 ? (await r.text()).slice(0, 6e5) : "" };
  } finally {
    clearTimeout(timer);
  }
}
async function fetchChannel(env, source) {
  const base = eitaaWeb(env), name = source.replace(/^@/, "");
  let last = { ok: false, status: 0, messages: [], title: "", note: "", snippet: "" };
  for (const path of [`/${name}`, `/s/${name}`]) {
    try {
      const { status, html } = await getPage(`${base}${path}`);
      if (status === 404) {
        last = { ...last, status, note: "\u06A9\u0627\u0646\u0627\u0644 \u067E\u06CC\u062F\u0627 \u0646\u0634\u062F (\u06F4\u06F0\u06F4)" };
        continue;
      }
      if (status !== 200) {
        last = { ...last, status, note: `\u067E\u0627\u0633\u062E HTTP ${status}` };
        continue;
      }
      const messages = parseMessages(html, name, base);
      last = {
        ok: messages.length > 0,
        status,
        messages,
        title: pageTitle(html),
        note: messages.length ? "" : "\u0635\u0641\u062D\u0647 \u0628\u0627\u0632 \u0634\u062F \u0648\u0644\u06CC \u067E\u06CC\u0627\u0645\u06CC \u062F\u0631 \u0622\u0646 \u0634\u0646\u0627\u0633\u0627\u06CC\u06CC \u0646\u0634\u062F (\u06A9\u0627\u0646\u0627\u0644 \u0639\u0645\u0648\u0645\u06CC \u0646\u06CC\u0633\u062A \u06CC\u0627 \u0633\u0627\u062E\u062A\u0627\u0631 \u0635\u0641\u062D\u0647 \u0641\u0631\u0642 \u062F\u0627\u0631\u062F)",
        snippet: htmlToText(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")).slice(0, 400)
      };
      if (messages.length) return last;
    } catch (e) {
      last = { ...last, note: `\u062E\u0637\u0627\u06CC \u0634\u0628\u06A9\u0647: ${e.message}` };
    }
  }
  return last;
}
async function fetchBytes(url, maxBytes, referer) {
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; MedyasBot/1.0)", ...referer ? { referer } : {} }, redirect: "follow" });
  if (!r.ok) throw new Error(`\u062F\u0627\u0646\u0644\u0648\u062F \u062A\u0635\u0648\u06CC\u0631 \u0645\u0646\u0628\u0639 \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062F (HTTP ${r.status})`);
  const len = parseInt(r.headers.get("content-length") || "0", 10);
  if (len > maxBytes) throw new Error("\u062D\u062C\u0645 \u062A\u0635\u0648\u06CC\u0631 \u0645\u0646\u0628\u0639 \u0632\u06CC\u0627\u062F \u0627\u0633\u062A");
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.length > maxBytes) throw new Error("\u062D\u062C\u0645 \u062A\u0635\u0648\u06CC\u0631 \u0645\u0646\u0628\u0639 \u0632\u06CC\u0627\u062F \u0627\u0633\u062A");
  return { bytes: buf, type: r.headers.get("content-type") || "" };
}
var extFor = (type, url) => {
  const t = type.toLowerCase();
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  if (t.includes("gif")) return "gif";
  if (t.includes("jpeg") || t.includes("jpg")) return "jpg";
  const m = url.split("?")[0].match(/\.(jpe?g|png|webp|gif)$/i);
  return m ? m[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
};
var PLATFORM_LINK = /(eitaa\.(com|ir)|t\.me|telegram\.(me|org)|ble\.ir|rubika\.ir|instagram\.com|wa\.me|chat\.whatsapp\.com|igap\.net|gap\.im|splus\.ir|sapp\.ir|soroush|youtube\.com|aparat\.com)\b/i;
var PROMO = /(عضو\s*(شوید|شو|بشید)|عضویت|ورود\s*به\s*کانال|لینک\s*کانال|کانال\s*(ما|رسمی)|ما\s*را\s*(در\s*\S+\s*)?دنبال|مارا\s*دنبال|دنبال\s*کنید|\bjoin\b|فالو\s*کنید|ارتباط\s*با\s*(ما|ادمین)|تبلیغات)/i;
var isSigLine = (line, title) => {
  const bare = line.replace(/[\s\p{P}\p{S}‌‏]+/gu, "");
  if (!bare) return true;
  if (line.length > 90) return false;
  if (/@[A-Za-z0-9_.]{3,}/.test(line) || PLATFORM_LINK.test(line)) return true;
  if (PROMO.test(line)) return true;
  const t = norm(title).replace(/[\s\p{P}\p{S}]+/gu, "");
  return !!t && t.length >= 3 && norm(line).replace(/[\s\p{P}\p{S}]+/gu, "").includes(t) && bare.length <= t.length + 12;
};
function cleanText(text, source, title = "") {
  let t = text.replace(new RegExp(`https?://(?:www\\.)?eitaa\\.com/(?:s/)?${escRe(source)}\\S*`, "gi"), "").replace(new RegExp(`@${escRe(source)}(?![A-Za-z0-9_])`, "gi"), "");
  let lines = t.split("\n").map((l) => l.replace(/[ \t]+$/g, ""));
  while (lines.length && isSigLine(lines[lines.length - 1], title)) lines.pop();
  while (lines.length && lines.length > 1 && isSigLine(lines[0], title) && lines[0].length < 60 && (/@|\/\/|eitaa/i.test(lines[0]) || !lines[0].replace(/[\s\p{P}\p{S}]+/gu, ""))) lines.shift();
  t = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return t;
}

// eitaa-src/tg.ts
var ikb = (rows) => ({ inline_keyboard: rows.map((r) => r.map(([text, callback_data]) => ({ text, callback_data }))) });
var TgError = class extends Error {
};
async function tg(env, method, body = {}) {
  const r = await fetch(`${tgBase(env)}/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new TgError(String(j.description || `HTTP ${r.status}`).replace(env.BOT_TOKEN, "***"));
  return j.result;
}
async function send(env, chat, text, kb) {
  try {
    const m = await tg(env, "sendMessage", { chat_id: chat, text: text.slice(0, 4e3), parse_mode: "HTML", reply_markup: kb, disable_web_page_preview: true });
    return m.message_id;
  } catch {
    return null;
  }
}
async function edit(env, chat, mid, text, kb) {
  try {
    await tg(env, "editMessageText", { chat_id: chat, message_id: mid, text: text.slice(0, 4e3), parse_mode: "HTML", reply_markup: kb });
  } catch {
  }
}
async function answer(env, id, text = "", alert = false) {
  try {
    await tg(env, "answerCallbackQuery", { callback_query_id: id, text, show_alert: alert });
  } catch {
  }
}
async function del(env, chat, mid) {
  try {
    await tg(env, "deleteMessage", { chat_id: chat, message_id: mid });
  } catch {
  }
}
async function download(env, fileId) {
  const f = await tg(env, "getFile", { file_id: fileId });
  if (!f.file_path) throw new TgError("\u0641\u0627\u06CC\u0644 \u062F\u0631 \u062A\u0644\u06AF\u0631\u0627\u0645 \u067E\u06CC\u062F\u0627 \u0646\u0634\u062F");
  const r = await fetch(`${tgBase(env)}/file/bot${env.BOT_TOKEN}/${f.file_path}`);
  if (!r.ok) throw new TgError(`\u062F\u0627\u0646\u0644\u0648\u062F \u0641\u0627\u06CC\u0644 \u0627\u0632 \u062A\u0644\u06AF\u0631\u0627\u0645 \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062F (HTTP ${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}
async function typing(env, chat) {
  try {
    await tg(env, "sendChatAction", { chat_id: chat, action: "typing" });
  } catch {
  }
}

// eitaa-src/agent.ts
var MAX_STEPS = 9;
var MAX_CHANNELS_PER_RUN = 5;
var MAX_POSTS_PER_RUN = 8;
var RETRY_WINDOW_S = 120 * 60;
var STALE_S = 3 * 3600;
var RUN_BUDGET_MS = 1e5;
var parseJson = (s, d) => {
  try {
    return s ? JSON.parse(s) : d;
  } catch {
    return d;
  }
};
function parseTimes(text) {
  const t = normDigits(text).replace(/،/g, " ");
  if (/(^|\s)(الان|همین ?الان|now)(\s|$)/i.test(t)) return "now";
  const out = /* @__PURE__ */ new Set();
  for (const m of t.matchAll(/(?<!\d)(\d{1,2})[:٫.](\d{2})(?!\d)/g)) {
    const h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    out.add(`${pad2(h)}:${pad2(mi)}`);
  }
  return out.size && out.size <= 8 ? [...out].sort() : null;
}
function describeSchedule(j) {
  if (j.once_at) return `\u06CC\u06A9\u200C\u0628\u0627\u0631\u060C ${fmtDt(j.once_at)}`;
  const times = parseJson(j.times, []), days = parseJson(j.days, null);
  if (!times.length) return "\u0641\u0642\u0637 \u0628\u0627 \u062F\u06A9\u0645\u0647\u200C\u06CC \xAB\u0627\u062C\u0631\u0627 \u0627\u0644\u0627\u0646\xBB";
  const d = days && days.length && days.length < 7 ? days.map((x) => WEEKDAYS[x]).join("\u060C ") : "\u0647\u0631 \u0631\u0648\u0632";
  return `${d}\u060C \u0633\u0627\u0639\u062A ${times.join(" \u0648 ")} (\u0648\u0642\u062A \u062A\u0647\u0631\u0627\u0646)`;
}
async function planJob(env, instruction) {
  const t = now(), l = toLocal(t);
  let r;
  try {
    r = await planWithModel(env, instruction, t, l);
  } catch {
    const tm = parseTimes(instruction);
    return {
      name: instruction.replace(/@\S+/g, "").trim().slice(0, 30) || "\u0627\u06CC\u062C\u0646\u062A",
      times: Array.isArray(tm) ? tm : [],
      days: null,
      onceAt: null,
      summary: "\u0628\u0631\u0646\u0627\u0645\u0647 \u0628\u0627 \u0642\u0648\u0627\u0646\u06CC\u0646 \u0633\u0627\u062F\u0647 \u062E\u0648\u0627\u0646\u062F\u0647 \u0634\u062F: " + (Array.isArray(tm) ? `\u0633\u0627\u0639\u062A ${tm.join(" \u0648 ")} \u0647\u0631 \u0631\u0648\u0632.` : "\u0628\u062F\u0648\u0646 \u0632\u0645\u0627\u0646 \u0645\u0634\u062E\u0635 (\u0641\u0642\u0637 \xAB\u0627\u062C\u0631\u0627 \u0627\u0644\u0627\u0646\xBB).")
    };
  }
  if (!r) return null;
  return planFrom(r, t);
}
var planWithModel = (env, instruction, t, l) => chatJson(
  env,
  `You read a Persian task description for a channel-content agent and extract its schedule. Reply with a JSON object only: {"name": short Persian title (max 30 chars), "times": array of "HH:MM" 24h Tehran times the task runs each day (empty array if no time is stated), "days": null if every day, otherwise array of weekday numbers 0=Sunday,1=Monday,...,6=Saturday (Saturday=\u0634\u0646\u0628\u0647, Friday=\u062C\u0645\u0639\u0647), "once": null, or "YYYY-MM-DD HH:MM" (Gregorian, Tehran time) if the task is a ONE-TIME task (e.g. "tomorrow at 9", "today 18:00"), "summary": one Persian sentence saying exactly what the agent will do}. Now in Tehran: ${l.y}-${pad2(l.mo)}-${pad2(l.d)} ${pad2(l.h)}:${pad2(l.mi)} (${jalaliLong(t)}).`,
  instruction,
  600
);
function planFrom(r, t) {
  const times = Array.isArray(r.times) ? parseTimes(r.times.join(" ")) : null;
  const days = Array.isArray(r.days) ? r.days.map(Number).filter((x) => x >= 0 && x <= 6) : null;
  let onceAt = null;
  const om = typeof r.once === "string" ? r.once.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/) : null;
  if (om) {
    onceAt = fromLocal({ y: +om[1], mo: +om[2], d: +om[3], h: +om[4], mi: +om[5] });
    if (onceAt < t + 30) onceAt = t + 60;
  }
  return {
    name: String(r.name || "\u0627\u06CC\u062C\u0646\u062A").slice(0, 40),
    times: onceAt || !Array.isArray(times) ? [] : times,
    days: days && days.length ? days : null,
    onceAt,
    summary: String(r.summary || "").slice(0, 400)
  };
}
function dueSlot(j, t) {
  if (j.run_now) return { key: `manual-${t}`, epoch: t, kind: "manual" };
  if (j.once_at) return !j.last_key && j.once_at <= t ? { key: "once", epoch: j.once_at, kind: "once" } : null;
  const times = parseJson(j.times, []), days = parseJson(j.days, null);
  const l = toLocal(t);
  if (days && days.length && !days.includes(new Date(Date.UTC(l.y, l.mo - 1, l.d)).getUTCDay())) return null;
  for (const hhmm of times) {
    const epoch = atTime(t, hhmm), key2 = slotKey(epoch);
    if (epoch <= t && key2 > j.last_key) return { key: key2, epoch, kind: "daily" };
  }
  return null;
}
async function agentTick(env) {
  if (!await llmReady(env)) return;
  const t = now();
  const jobs = (await env.DB.prepare("SELECT * FROM agent_jobs WHERE enabled=1 AND (retry_at IS NULL OR retry_at<=?) ORDER BY id LIMIT 200").bind(t).all()).results;
  let ran = 0;
  for (const j of jobs) {
    const slot = dueSlot(j, t);
    if (!slot) continue;
    if (slot.kind === "daily" && j.attempts === 0 && t - slot.epoch > STALE_S) {
      await env.DB.prepare("UPDATE agent_jobs SET last_key=? WHERE id=?").bind(slot.key, j.id).run();
      continue;
    }
    if (ran >= 2) break;
    ran++;
    try {
      await runJob(env, j, slot, t);
    } catch (e) {
      console.error("agent job failed", j.id, e.message);
    }
  }
}
async function runJob(env, j, slot, t) {
  const claim = await env.DB.prepare("UPDATE agent_jobs SET retry_at=?, attempts=attempts+1, run_now=0 WHERE id=? AND (retry_at IS NULL OR retry_at<=?) AND attempts=?").bind(t + 300, j.id, t, j.attempts).run();
  if (!claim.meta.changes) return;
  const final = slot.kind === "manual" || j.attempts + 1 >= 3 || t - slot.epoch > RETRY_WINDOW_S;
  let res;
  try {
    res = await runAgent(env, j, slot, final);
  } catch (e) {
    res = { summary: e.message, posts: 0, retryMin: null, error: true };
  }
  const retry = !final && res.retryMin ? Math.min(Math.max(res.retryMin, 2), 30) : 0;
  const info = `${fmtDt(now())} \u2014 ${res.posts} \u067E\u0633\u062A \u2014 ${res.summary}`.slice(0, 500);
  if (retry) {
    await env.DB.prepare("UPDATE agent_jobs SET retry_at=?, last_info=? WHERE id=?").bind(now() + retry * 60, info, j.id).run();
  } else {
    await env.DB.prepare(`UPDATE agent_jobs SET ${slot.kind === "manual" ? "" : "last_key=?, "}retry_at=NULL, attempts=0, last_info=?${slot.kind === "once" ? ", enabled=0" : ""} WHERE id=?`).bind(...slot.kind === "manual" ? [info, j.id] : [slot.key, info, j.id]).run();
  }
  if (!retry && (res.posts === 0 || res.error || slot.kind === "manual"))
    await send(env, j.user_id, `\u{1F916} <b>${esc(j.name || "\u0627\u06CC\u062C\u0646\u062A")}</b>
${res.error ? "\u274C " : ""}${esc(res.summary)}${res.posts ? `
\u{1F4DD} ${res.posts} \u067E\u0633\u062A \u0633\u0627\u062E\u062A\u0647 \u0634\u062F.` : ""}`);
  if (retry) console.log("agent retry", j.id, retry);
}
var PREVIEW = 260;
var PREVIEW_FULL = 1e3;
var MAX_POSTS_SHOWN = 8;
var MAX_AGE_S = 3 * 86400;
async function readChannel(env, st, a, jobId, maxChannels) {
  const cid = normalizeChatId(String(a.channel || "")).replace(/^@/, "");
  if (!/^[A-Za-z0-9_.]{3,64}$/.test(cid) || /^\d+$/.test(cid)) return { error: "invalid channel username" };
  if (!st.channels.has(cid) && st.channels.size >= maxChannels) return { error: `at most ${maxChannels} channels per run` };
  let r = st.channels.get(cid);
  if (!r) {
    r = await fetchChannel(env, cid);
    st.channels.set(cid, r);
  }
  if (!r.ok) return { error: r.note || "could not read channel (is it public?)" };
  const limit = Math.min(Math.max(parseInt(a.limit, 10) || MAX_POSTS_SHOWN, 1), 20), cut = a.full ? PREVIEW_FULL : PREVIEW, t = now();
  const seen = jobId === null ? /* @__PURE__ */ new Set() : new Set((await env.DB.prepare("SELECT k FROM agent_seen WHERE job_id=?").bind(jobId).all()).results.map((x) => x.k));
  let hidden = 0;
  const posts = [];
  for (const m of r.messages.slice().reverse()) {
    const ref = `${cid}/${m.id}`;
    if (seen.has(ref) || m.ts !== null && t - m.ts > MAX_AGE_S) {
      hidden++;
      continue;
    }
    const text = cleanText(m.text, cid, r.title);
    st.refs.set(ref, { image: m.image, text, sticker: m.sticker });
    if (posts.length >= limit) continue;
    const d = m.ts ? toLocal(m.ts) : null;
    posts.push({ ref, ...d ? { date: `${d.y}-${pad2(d.mo)}-${pad2(d.d)} ${pad2(d.h)}:${pad2(d.mi)}` } : {}, text: text.slice(0, cut) + (text.length > cut ? "\u2026" : ""), ...m.image && !m.sticker ? { image: 1 } : {}, ...m.sticker ? { sticker: 1 } : {} });
  }
  return { channel: cid, posts, ...hidden ? { hidden_old_or_used: hidden } : {} };
}
function resolvePost(st, a, footer) {
  let text = String(a.text || "").trim();
  const fromRef = a.from_ref ? String(a.from_ref) : "", imageRef = a.image_ref ? String(a.image_ref) : "";
  if (fromRef && !text) {
    const r = st.refs.get(fromRef);
    if (!r) return { error: "unknown from_ref (use a ref from read_channel)" };
    text = r.text;
  }
  const ri = imageRef ? st.refs.get(imageRef) : void 0;
  if (imageRef && !ri?.image) return { error: "image_ref has no image/sticker" };
  const sticker = !!ri?.sticker;
  if (sticker) text = "";
  if (!text && !ri) return { error: "empty post" };
  const full = text ? text + (footer ? `

${footer}` : "") : "";
  if (ri && !sticker && full.length > 1e3) return { error: "text+signature too long for a post with image (max 1000 chars): shorten or drop image_ref" };
  if (full.length > 3900) return { error: "text too long (max ~3900)" };
  return { text: full, image: ri?.image || "", sticker, refs: [fromRef, imageRef].filter(Boolean) };
}
var POST_PARAMS = {
  text: { type: "string", description: "post text; omit when forwarding a source post via from_ref" },
  from_ref: { type: "string", description: "ref of a source post: its full cleaned text is used as-is" },
  image_ref: { type: "string", description: "ref of a source post whose image/sticker to attach" }
};
var TOOLS = (final) => [
  { type: "function", function: {
    name: "read_channel",
    description: "Latest unused posts of a PUBLIC Eitaa channel (@id), newest first, short previews. image/sticker=1 flags media.",
    parameters: { type: "object", properties: { channel: { type: "string" }, full: { type: "boolean", description: "longer previews (only if you must rewrite)" } }, required: ["channel"] }
  } },
  { type: "function", function: {
    name: "post_to_channel",
    description: "Publish to the owner's channel (his signature is appended by the system). Call it ONCE per post, all posts in the same step.",
    parameters: { type: "object", properties: { ...POST_PARAMS, delay_minutes: { type: "integer", description: "0-720; spread several posts" } } }
  } },
  ...final ? [] : [{ type: "function", function: {
    name: "retry_later",
    description: "The needed content does not exist YET (e.g. today's post not published). Retry the whole task later. Only if nothing was published.",
    parameters: { type: "object", properties: { minutes: { type: "integer", description: "5-30" }, reason: { type: "string" } }, required: ["minutes", "reason"] }
  } }]
];
var AD_RE = /تبلیغ|قرعه.?کشی|جایزه|تخفیف|فروش ویژه|ثبت.?نام|سفارش|خرید|کد تخفیف|عضو شوید|لینک عضویت|join|https?:\/\/t\.me|بنر/i;
var STOP = new Set("\u0627\u0632 \u062F\u0631 \u0628\u0647 \u0628\u0627 \u06A9\u0647 \u0631\u0627 \u0627\u06CC\u0646 \u0622\u0646 \u0628\u0631\u0627\u06CC \u0648 \u06CC\u0627 \u0647\u0631 \u0631\u0648\u0632 \u0633\u0627\u0639\u062A \u0635\u0628\u062D \u0638\u0647\u0631 \u0634\u0628 \u06A9\u0627\u0646\u0627\u0644 \u06A9\u0627\u0646\u0627\u0644\u0645 \u06A9\u0627\u0646\u0627\u0644\u200C\u0647\u0627\u06CC \u0645\u0637\u0644\u0628 \u0645\u0637\u0627\u0644\u0628 \u067E\u0633\u062A \u0628\u06CC\u0627\u0648\u0631 \u0628\u06AF\u0630\u0627\u0631 \u0628\u0630\u0627\u0631 \u0628\u06AF\u06CC\u0631 \u062F\u0631\u0628\u0627\u0631\u0647 \u0645\u0641\u06CC\u062F \u0628\u0627\u0634\u062F \u0646\u0628\u0627\u0634\u062F \u062A\u0628\u0644\u06CC\u063A \u0627\u0645\u0631\u0648\u0632 \u062A\u0627\u0631\u06CC\u062E \u0647\u0645\u0627\u0646 \u062F\u0642\u06CC\u0642\u0627 \u062F\u0642\u06CC\u0642\u0627\u064B \u0686\u0646\u062F \u06CC\u06A9 \u062F\u0648 \u0633\u0647 \u0628\u0627\u0631 \u0628\u0639\u062F \u0642\u0628\u0644 \u062E\u0648\u062F\u062A \u0628\u0646\u0648\u06CC\u0633".split(/\s+/));
var words = (t) => normDigits(t).replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));
async function heuristicRun(env, j, t) {
  const instr = j.instruction, srcs = [...new Set([...instr.matchAll(/@([A-Za-z0-9_.]{3,64})/g)].map((m) => m[1]))].filter((c) => c.toLowerCase() !== "").slice(0, MAX_CHANNELS_PER_RUN);
  if (!srcs.length) return { summary: "\u0633\u0647\u0645\u06CC\u0647\u200C\u06CC \u0647\u0648\u0634 \u0645\u0635\u0646\u0648\u0639\u06CC \u0627\u0645\u0631\u0648\u0632 \u062A\u0645\u0627\u0645 \u0634\u062F\u0647 \u0648 \u0627\u06CC\u0646 \u06A9\u0627\u0631 \u0645\u0646\u0628\u0639 \u0645\u0634\u062E\u0635\u06CC \u0646\u062F\u0627\u0631\u062F\u061B \u0641\u0631\u062F\u0627 \u06CC\u0627 \u0628\u0627 \u062F\u06A9\u0645\u0647\u200C\u06CC \xAB\u0627\u062C\u0631\u0627 \u0627\u0644\u0627\u0646\xBB \u062F\u0648\u0628\u0627\u0631\u0647 \u062A\u0644\u0627\u0634 \u0645\u06CC\u200C\u0634\u0648\u062F.", posts: 0, retryMin: null, error: true };
  const nm = normDigits(instr).match(/(\d)\s*(?:تا)?\s*(?:مطلب|پست|خبر|مورد)/), want = Math.min(nm ? +nm[1] : 1, 3);
  const needDate = /تاریخ/.test(instr), topic = new Set(words(instr.replace(/@\S+/g, "")));
  const st = { channels: /* @__PURE__ */ new Map(), refs: /* @__PURE__ */ new Map() };
  const cands = [];
  const recent = (await env.DB.prepare("SELECT text FROM ea_posts WHERE job_id=? AND created_at>? AND status IN ('pending','draft','sending','sent')").bind(j.id, t - 3 * 86400).all()).results;
  const recentNorm = new Set(recent.map((r) => norm(r.text).replace(/\s+/g, " ").slice(0, 120)));
  for (const c of srcs) {
    const res = await readChannel(env, st, { channel: c, limit: 20 }, j.id, MAX_CHANNELS_PER_RUN);
    for (const p of res.posts || []) {
      const r = st.refs.get(p.ref);
      if (r.sticker || AD_RE.test(r.text) || r.text.length < 40 && !r.image) continue;
      if (needDate && !(mentionsDay(r.text, t) && !mentionsOtherDate(r.text, t))) continue;
      const hit = words(r.text).filter((w) => topic.has(w)).length;
      if (!needDate && topic.size > 2 && hit === 0) continue;
      cands.push({ ref: p.ref, score: hit + Math.min(r.text.length, 600) / 600, r });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  let n = 0;
  for (const c of cands) {
    if (n >= want) break;
    const p = resolvePost(st, { from_ref: c.ref, ...c.r.image ? { image_ref: c.ref } : {} }, j.footer);
    const q = "error" in p ? resolvePost(st, { from_ref: c.ref }, j.footer) : p;
    if ("error" in q) continue;
    const sig = norm(q.text).replace(/\s+/g, " ").slice(0, 120);
    if (recentNorm.has(sig)) continue;
    recentNorm.add(sig);
    const draft = !!j.approve;
    const ins = await env.DB.prepare("INSERT INTO ea_posts(user_id,channel_id,kind,text,file_id,file_name,title,silent,pin,view_delete,run_at,status,created_at,src_url,job_id) VALUES(?,?,?,?,'',?,'',0,0,0,?,?,?,?,?)").bind(j.user_id, j.channel_id, q.image ? "file" : "text", q.text, "", now() + n * 20 * 60, draft ? "draft" : "pending", now(), q.image, j.id).run();
    await env.DB.prepare("INSERT OR IGNORE INTO agent_seen(job_id,k,seen_at) VALUES(?,?,?)").bind(j.id, c.ref, now()).run();
    if (draft) await send(env, j.user_id, `\u{1F4DD} <b>\u067E\u06CC\u0634\u200C\u0646\u0648\u06CC\u0633 \u0627\u06CC\u062C\u0646\u062A \xAB${esc(j.name)}\xBB</b> (#${ins.meta.last_row_id})

${esc(q.text.slice(0, 1500))}`, ikb([[["\u2705 \u0627\u0646\u062A\u0634\u0627\u0631", `ag:go:${ins.meta.last_row_id}`], ["\u{1F5D1} \u062D\u0630\u0641", `ag:no:${ins.meta.last_row_id}`]]]));
    n++;
  }
  return { summary: n ? `\u0633\u0647\u0645\u06CC\u0647\u200C\u06CC \u0647\u0648\u0634 \u0645\u0635\u0646\u0648\u0639\u06CC \u062A\u0645\u0627\u0645 \u0628\u0648\u062F\u061B \u0628\u0627 \u0645\u0648\u062A\u0648\u0631 \u0642\u0627\u0646\u0648\u0646\u200C\u0645\u062D\u0648\u0631 ${n} \u067E\u0633\u062A \u0627\u0646\u062A\u062E\u0627\u0628 \u0634\u062F.` : "\u0633\u0647\u0645\u06CC\u0647\u200C\u06CC \u0647\u0648\u0634 \u0645\u0635\u0646\u0648\u0639\u06CC \u062A\u0645\u0627\u0645 \u0628\u0648\u062F \u0648 \u0645\u0637\u0644\u0628 \u0645\u0646\u0627\u0633\u0628\u06CC \u0628\u0627 \u0642\u0648\u0627\u0646\u06CC\u0646 \u0633\u0627\u062F\u0647 \u067E\u06CC\u062F\u0627 \u0646\u0634\u062F.", posts: n, retryMin: null };
}
async function runAgent(env, j, slot, final) {
  const ch = await getChannel(env, j.channel_id);
  if (!ch || ch.user_id !== j.user_id) return { summary: "\u06A9\u0627\u0646\u0627\u0644 \u0645\u0642\u0635\u062F \u062F\u06CC\u06AF\u0631 \u0648\u062C\u0648\u062F \u0646\u062F\u0627\u0631\u062F.", posts: 0, retryMin: null, error: true };
  const t0 = Date.now(), t = now(), l = toLocal(t);
  const recent = (await env.DB.prepare("SELECT text FROM ea_posts WHERE job_id=? AND created_at>? AND status IN ('pending','draft','sending','sent') ORDER BY id DESC LIMIT 6").bind(j.id, t - 3 * 86400).all()).results;
  const state = { posts: 0, retryMin: null, summary: "", done: false, channels: /* @__PURE__ */ new Map(), refs: /* @__PURE__ */ new Map() };
  const recentNorm = new Set(recent.map((r) => norm(r.text).replace(/\s+/g, " ").slice(0, 120)));
  const system = `You run a task for an Eitaa channel owner. Reply/write in Persian. Use tools; be brief.
TASK:
${j.instruction}

Today (Tehran): ${jalaliLong(t)} | ${l.y}-${pad2(l.mo)}-${pad2(l.d)} ${pad2(l.h)}:${pad2(l.mi)}
Rules: read only channels named in the task. Never invent posts. To forward a source post use post_to_channel(from_ref) \u2014 never retype it; to rewrite, write text yourself (no source names/@ids/links). Skip ads/giveaways/off-topic. No near-duplicates of RECENT. "N posts" = maximum; fewer or none is fine. Spread several posts with delay_minutes. A required date must be today's; a source post showing another date is unacceptable. ` + (final ? "LAST attempt: if no suitable source post exists, write the post yourself per the task and publish it. " : "If the needed content does not exist yet and you published nothing, call retry_later. ") + `When done with nothing to publish, answer with one short Persian sentence explaining why.
RECENT:
${recent.length ? recent.map((r) => `- ${r.text.replace(/\s+/g, " ").slice(0, 70)}`).join("\n") : "(none)"}`;
  let postedThisStep = 0;
  const exec = async (name, a) => {
    switch (name) {
      case "read_channel":
        return readChannel(env, state, a, j.id, MAX_CHANNELS_PER_RUN);
      case "post_to_channel": {
        if (state.posts >= MAX_POSTS_PER_RUN) return { error: "post limit for this run reached" };
        const p = resolvePost(state, a, j.footer);
        if ("error" in p) return p;
        const sig = norm(p.text).replace(/\s+/g, " ").slice(0, 120);
        if (sig && recentNorm.has(sig)) return { error: "duplicate of something already published" };
        const delay = Math.min(Math.max(parseInt(a.delay_minutes, 10) || 0, 0), 720), draft = !!j.approve;
        const ins = await env.DB.prepare("INSERT INTO ea_posts(user_id,channel_id,kind,text,file_id,file_name,title,silent,pin,view_delete,run_at,status,created_at,src_url,job_id) VALUES(?,?,?,?,'',?,'',0,0,0,?,?,?,?,?)").bind(j.user_id, j.channel_id, p.image ? "file" : "text", p.text, p.sticker ? "sticker.webp" : "", now() + delay * 60, draft ? "draft" : "pending", now(), p.image, j.id).run();
        const postId = ins.meta.last_row_id;
        recentNorm.add(sig);
        state.posts++;
        postedThisStep++;
        const keys = [...new Set(p.refs)].filter((k) => /^[A-Za-z0-9_.]+\/\d+$/.test(k));
        if (keys.length) await env.DB.batch(keys.map((k) => env.DB.prepare("INSERT OR IGNORE INTO agent_seen(job_id,k,seen_at) VALUES(?,?,?)").bind(j.id, k, now())));
        if (draft) await send(env, j.user_id, `\u{1F4DD} <b>\u067E\u06CC\u0634\u200C\u0646\u0648\u06CC\u0633 \u0627\u06CC\u062C\u0646\u062A \xAB${esc(j.name)}\xBB</b> (#${postId})${p.image ? " \u{1F5BC}" : ""}

${esc(p.text.slice(0, 1500))}`, ikb([[["\u2705 \u0627\u0646\u062A\u0634\u0627\u0631", `ag:go:${postId}`], ["\u{1F5D1} \u062D\u0630\u0641", `ag:no:${postId}`]]]));
        return { ok: true, post_id: postId };
      }
      case "retry_later": {
        if (final) return { error: "not allowed in the last attempt \u2014 publish now" };
        if (state.posts) return { error: "you already published in this run" };
        state.retryMin = Math.min(Math.max(parseInt(a.minutes, 10) || 10, 5), 30);
        state.summary = String(a.reason || "").slice(0, 300);
        state.done = true;
        return { ok: true };
      }
    }
    return { error: `unknown tool ${name}` };
  };
  const messages = [{ role: "system", content: system }, { role: "user", content: "Go." }];
  const tools = TOOLS(final);
  for (let step = 0; step < MAX_STEPS && !state.done; step++) {
    if (Date.now() - t0 > RUN_BUDGET_MS) {
      state.summary ||= "\u0632\u0645\u0627\u0646 \u0627\u062C\u0631\u0627 \u062A\u0645\u0627\u0645 \u0634\u062F.";
      break;
    }
    let m;
    try {
      m = await chatTools(env, messages, tools, 45e3, 900);
    } catch (e) {
      if (step === 0 && !state.posts) return heuristicRun(env, j, t);
      throw e;
    }
    messages.push(m);
    if (!m.tool_calls?.length) {
      state.summary ||= (m.content || "").trim().slice(0, 400);
      break;
    }
    postedThisStep = 0;
    for (const c of m.tool_calls) {
      let out;
      try {
        out = await exec(c.function.name, JSON.parse(c.function.arguments || "{}"));
      } catch (e) {
        out = { error: e.message };
      }
      messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(out).slice(0, 12e3) });
    }
    if (postedThisStep > 0) {
      state.done = true;
      state.summary ||= `${state.posts} \u067E\u0633\u062A \u0633\u0627\u062E\u062A\u0647 \u0634\u062F.`;
    }
  }
  if (!state.summary) state.summary = state.posts ? "\u0627\u0646\u062C\u0627\u0645 \u0634\u062F." : "\u06A9\u0627\u0631\u06CC \u0627\u0646\u062C\u0627\u0645 \u0646\u0634\u062F.";
  return { summary: state.summary, posts: state.posts, retryMin: state.retryMin };
}

// eitaa-src/agentui.ts
var MAX_JOBS = 5;
var GUIDE = "\u270D\uFE0F <b>\u0628\u0647 \u0627\u06CC\u062C\u0646\u062A \u0628\u06AF\u0648\u06CC\u06CC\u062F \u0686\u0647 \u06A9\u0627\u0631\u06CC \u0627\u0646\u062C\u0627\u0645 \u062F\u0647\u062F</b> (\u0628\u0627 \u0632\u0628\u0627\u0646 \u0633\u0627\u062F\u0647\u060C \u0647\u0631 \u0686\u0647 \u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u06CC\u062F):\n\n\u2022 <i>\u0647\u0631 \u0631\u0648\u0632 \u0633\u0627\u0639\u062A \u06F7 \u0635\u0628\u062D \u0627\u0632 \u06A9\u0627\u0646\u0627\u0644 @goodmorning_ch \u067E\u06CC\u0627\u0645 \u0635\u0628\u062D\u200C\u0628\u062E\u06CC\u0631 \u0627\u0645\u0631\u0648\u0632 \u0631\u0627 (\u0647\u0645\u0627\u0646 \u06A9\u0647 \u062A\u0627\u0631\u06CC\u062E \u0627\u0645\u0631\u0648\u0632 \u062F\u0627\u0631\u062F) \u062F\u0631 \u06A9\u0627\u0646\u0627\u0644\u0645 \u0628\u06AF\u0630\u0627\u0631</i>\n\u2022 <i>\u0631\u0648\u0632\u06CC \u06F3 \u0628\u0627\u0631\u060C \u0633\u0627\u0639\u062A \u06F9 \u0648 \u06F1\u06F4 \u0648 \u06F2\u06F0\u060C \u0627\u0632 \u06A9\u0627\u0646\u0627\u0644\u200C\u0647\u0627\u06CC @a \u0648 @b \u062F\u0648 \u0645\u0637\u0644\u0628 \u0645\u0641\u06CC\u062F \u062F\u0631\u0628\u0627\u0631\u0647\u200C\u06CC \u0648\u0631\u0632\u0634 \u0628\u06CC\u0627\u0648\u0631\u061B \u062A\u0628\u0644\u06CC\u063A \u0646\u0628\u0627\u0634\u062F</i>\n\u2022 <i>\u0647\u0631 \u0634\u0628 \u0633\u0627\u0639\u062A \u06F2\u06F1 \u06CC\u06A9 \u062C\u0645\u0644\u0647\u200C\u06CC \u0627\u0646\u06AF\u06CC\u0632\u0634\u06CC \u06A9\u0648\u062A\u0627\u0647 \u062E\u0648\u062F\u062A \u0628\u0646\u0648\u06CC\u0633 \u0648 \u0628\u06AF\u0630\u0627\u0631</i>\n\n\u0633\u0627\u0639\u062A\u060C \u0631\u0648\u0632 \u0648 \u06A9\u0627\u0646\u0627\u0644\u200C\u0647\u0627\u06CC \u0645\u0646\u0628\u0639 \u0631\u0627 \u062F\u0627\u062E\u0644 \u0647\u0645\u06CC\u0646 \u0645\u062A\u0646 \u0628\u0646\u0648\u06CC\u0633\u06CC\u062F. (\u0641\u0642\u0637 \u06A9\u0627\u0646\u0627\u0644\u200C\u0647\u0627\u06CC <b>\u0639\u0645\u0648\u0645\u06CC</b> \u0627\u06CC\u062A\u0627 \u062E\u0648\u0627\u0646\u062F\u0647 \u0645\u06CC\u200C\u0634\u0648\u0646\u062F.)\n\u0644\u063A\u0648: /cancel";
async function home(env, u) {
  const ready = await llmReady(env);
  if (!ready) return void await send(env, u.id, "\u23F3 \u0627\u06CC\u062C\u0646\u062A \u0647\u0648\u0634\u0645\u0646\u062F \u0647\u0646\u0648\u0632 \u0641\u0639\u0627\u0644 \u0646\u0634\u062F\u0647 \u0627\u0633\u062A (\u0628\u0627\u06CC\u0646\u062F\u06CC\u0646\u06AF AI \u062F\u0631 wrangler.jsonc \u0641\u0639\u0627\u0644 \u0646\u06CC\u0633\u062A).");
  const jobs = await userJobs(env, u.id);
  const rows = jobs.map((j) => [[`${j.enabled ? "\u{1F7E2}" : "\u26AA\uFE0F"} ${j.name || "\u0627\u06CC\u062C\u0646\u062A " + j.id}`.slice(0, 40), `ag:v:${j.id}`]]);
  if (jobs.length < MAX_JOBS) rows.push([["\u2795 \u0627\u06CC\u062C\u0646\u062A \u062C\u062F\u06CC\u062F", "ag:new"]]);
  await send(env, u.id, jobs.length ? "<b>\u{1F916} \u0627\u06CC\u062C\u0646\u062A\u200C\u0647\u0627\u06CC \u0634\u0645\u0627</b>" : "\u{1F916} <b>\u0627\u06CC\u062C\u0646\u062A \u0647\u0648\u0634\u0645\u0646\u062F</b>\n\u06A9\u0627\u0631\u06CC \u06A9\u0647 \u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u06CC\u062F \u062E\u0648\u062F\u06A9\u0627\u0631 \u0627\u0646\u062C\u0627\u0645 \u0634\u0648\u062F \u0631\u0627 \u0628\u0647 \u0632\u0628\u0627\u0646 \u0633\u0627\u062F\u0647 \u0628\u06AF\u0648\u06CC\u06CC\u062F\u061B \u0627\u06CC\u062C\u0646\u062A \u062F\u0631 \u0633\u0627\u0639\u062A \u062A\u0639\u06CC\u06CC\u0646\u200C\u0634\u062F\u0647 \u0622\u0646 \u0631\u0627 \u0627\u0646\u062C\u0627\u0645 \u0645\u06CC\u200C\u062F\u0647\u062F.", ikb(rows));
}
var view = async (env, j) => {
  const ch = await getChannel(env, j.channel_id);
  return {
    text: `<b>\u{1F916} ${esc(j.name || "\u0627\u06CC\u062C\u0646\u062A")}</b> ${j.enabled ? "\u{1F7E2} \u0641\u0639\u0627\u0644" : "\u26AA\uFE0F \u063A\u06CC\u0631\u0641\u0639\u0627\u0644"}

\u{1F4E3} \u06A9\u0627\u0646\u0627\u0644 \u0645\u0642\u0635\u062F: ${esc(ch?.title || "\u061F")}
\u23F0 ${esc(describeSchedule(j))}
\u2705 \u062A\u0623\u06CC\u06CC\u062F \u062F\u0633\u062A\u06CC \u0642\u0628\u0644 \u0627\u0632 \u0627\u0646\u062A\u0634\u0627\u0631: ${j.approve ? "\u0631\u0648\u0634\u0646" : "\u062E\u0627\u0645\u0648\u0634"}
\u{1F58B} \u0627\u0645\u0636\u0627: ${j.footer ? "\n<code>" + esc(j.footer.slice(0, 200)) + "</code>" : "\u0646\u062F\u0627\u0631\u062F"}

\u{1F4DD} \u062F\u0633\u062A\u0648\u0631:
${esc(j.instruction.slice(0, 700))}` + (j.last_info ? `

\u{1F558} \u0622\u062E\u0631\u06CC\u0646 \u0627\u062C\u0631\u0627: ${esc(j.last_info)}` : ""),
    kb: ikb([
      [["\u25B6\uFE0F \u0627\u062C\u0631\u0627 \u0627\u0644\u0627\u0646", `ag:run:${j.id}`], [j.enabled ? "\u23F8 \u062A\u0648\u0642\u0641" : "\u25B6\uFE0F \u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC", `ag:tg:${j.id}`]],
      [["\u270F\uFE0F \u062F\u0633\u062A\u0648\u0631", `ag:ed:${j.id}`], ["\u23F0 \u0632\u0645\u0627\u0646\u200C\u0647\u0627", `ag:tm:${j.id}`], ["\u{1F58B} \u0627\u0645\u0636\u0627", `ag:ft:${j.id}`]],
      [[`\u2705 \u062A\u0623\u06CC\u06CC\u062F \u062F\u0633\u062A\u06CC: ${j.approve ? "\u0631\u0648\u0634\u0646" : "\u062E\u0627\u0645\u0648\u0634"}`, `ag:ap:${j.id}`]],
      [["\u{1F5D1} \u062D\u0630\u0641", `ag:del:${j.id}`]]
    ])
  };
};
async function show(env, uid, j, mid) {
  const v = await view(env, j);
  if (mid) await edit(env, uid, mid, v.text, v.kb);
  else await send(env, uid, v.text, v.kb);
}
async function askInstruction(env, uid, data) {
  await setSession(env, uid, "ag_instr", data);
  await send(env, uid, GUIDE);
}
async function confirm(env, uid, d) {
  const plan = d.plan, ch = await getChannel(env, d.channel_id);
  const sched = describeSchedule({ times: JSON.stringify(plan.times), days: plan.days ? JSON.stringify(plan.days) : null, once_at: plan.onceAt });
  await setSession(env, uid, "ag_confirm", d);
  await send(
    env,
    uid,
    `<b>\u{1F916} ${esc(plan.name)}</b>

${esc(plan.summary)}

\u{1F4E3} \u06A9\u0627\u0646\u0627\u0644 \u0645\u0642\u0635\u062F: ${esc(ch?.title || "\u061F")}
\u23F0 ${esc(sched)}
\u{1F58B} \u0627\u0645\u0636\u0627: ${d.footer ? "\n<code>" + esc(d.footer) + "</code>" : "\u0646\u062F\u0627\u0631\u062F"}

\u0628\u0631\u0627\u06CC \u0633\u0627\u062E\u062A \u062A\u0623\u06CC\u06CC\u062F \u06A9\u0646\u06CC\u062F \u{1F447}`,
    ikb([[["\u2705 \u0633\u0627\u062E\u062A \u0627\u06CC\u062C\u0646\u062A", "ag:mk"], ["\u270F\uFE0F \u062A\u063A\u06CC\u06CC\u0631 \u062F\u0633\u062A\u0648\u0631", "ag:redo"]], [["\u274C \u0644\u063A\u0648", "ag:x"]]])
  );
}
async function createJob(env, uid, d) {
  const plan = d.plan, t = now();
  const r = await env.DB.prepare("INSERT INTO agent_jobs(user_id,channel_id,name,instruction,times,days,once_at,footer,last_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(
    uid,
    d.channel_id,
    plan.name,
    d.instruction,
    JSON.stringify(plan.times),
    plan.days ? JSON.stringify(plan.days) : null,
    plan.onceAt,
    d.footer || "",
    plan.onceAt ? "" : slotKey(t),
    t
  ).run();
  return await getJob(env, r.meta.last_row_id);
}
var WHEN_HELP = "\u23F0 \u0633\u0627\u0639\u062A \u0627\u062C\u0631\u0627 \u0631\u0627 \u0628\u0641\u0631\u0633\u062A\u06CC\u062F (\u0648\u0642\u062A \u062A\u0647\u0631\u0627\u0646)\u060C \u0645\u062B\u0644\u0627\u064B <code>07:00</code> \u06CC\u0627 <code>09:00 14:00 20:00</code> (\u0647\u0631 \u0631\u0648\u0632).\n\u0628\u0631\u0627\u06CC \u06CC\u06A9\u200C\u0628\u0627\u0631 \u0627\u062C\u0631\u0627 \u0647\u0645\u06CC\u0646 \u0627\u0644\u0627\u0646: <code>\u0627\u0644\u0627\u0646</code>";
async function onText(c, user, admin, state, d, text) {
  const { env } = c, uid = user.id;
  switch (state) {
    case "ag_instr": {
      if (text.length < 10) return void await send(env, uid, "\u062F\u0633\u062A\u0648\u0631 \u062E\u06CC\u0644\u06CC \u06A9\u0648\u062A\u0627\u0647 \u0627\u0633\u062A\u061B \u06A9\u0645\u06CC \u06A9\u0627\u0645\u0644\u200C\u062A\u0631 \u0628\u0646\u0648\u06CC\u0633\u06CC\u062F (\u06CC\u0627 /cancel).");
      if (text.length > 2e3) return void await send(env, uid, "\u062F\u0633\u062A\u0648\u0631 \u0628\u06CC\u0634 \u0627\u0632 \u06F2\u06F0\u06F0\u06F0 \u0646\u0648\u06CC\u0633\u0647 \u0627\u0633\u062A\u061B \u06A9\u0648\u062A\u0627\u0647\u200C\u062A\u0631\u0634 \u06A9\u0646\u06CC\u062F.");
      d.instruction = text;
      await setSession(env, uid, "ag_footer", d);
      return void await send(env, uid, "\u{1F58B} <b>\u0627\u0645\u0636\u0627\u06CC \u062B\u0627\u0628\u062A \u067E\u0627\u06CC\u06CC\u0646 \u0647\u0631 \u067E\u0633\u062A</b> \u0631\u0627 \u0628\u0641\u0631\u0633\u062A\u06CC\u062F (\u0645\u062B\u0644\u0627\u064B \u0622\u06CC\u062F\u06CC \u0648 \u0645\u0639\u0631\u0641\u06CC \u06A9\u0627\u0646\u0627\u0644 \u062E\u0648\u062F\u062A\u0627\u0646). \u062F\u0642\u06CC\u0642\u0627\u064B \u0647\u0645\u0627\u0646\u200C\u0637\u0648\u0631 \u06A9\u0647 \u0628\u0646\u0648\u06CC\u0633\u06CC\u062F \u0632\u06CC\u0631 \u0647\u0631 \u067E\u0633\u062A \u06AF\u0630\u0627\u0634\u062A\u0647 \u0645\u06CC\u200C\u0634\u0648\u062F.\n\u0628\u062F\u0648\u0646 \u0627\u0645\u0636\u0627: <code>-</code>");
    }
    case "ag_footer": {
      d.footer = text === "-" ? "" : text.slice(0, 500);
      await send(env, uid, "\u{1F50E} \u062F\u0631 \u062D\u0627\u0644 \u062A\u062D\u0644\u06CC\u0644 \u062F\u0633\u062A\u0648\u0631\u2026");
      let plan = null, why = "\u067E\u0627\u0633\u062E \u0642\u0627\u0628\u0644\u200C\u0641\u0647\u0645\u06CC \u0646\u06AF\u0631\u0641\u062A\u0645";
      try {
        plan = await planJob(env, String(d.instruction));
      } catch (e) {
        why = e.message;
      }
      if (!plan) {
        await setSession(env, uid, "ag_footer", d);
        return void await send(env, uid, `\u274C ${esc(why)}.
\u0645\u0634\u06A9\u0644 \u06A9\u0647 \u0628\u0631\u0637\u0631\u0641 \u0634\u062F\u060C \u062F\u0648\u0628\u0627\u0631\u0647 \u0627\u0645\u0636\u0627 \u0631\u0627 (\u06CC\u0627 <code>-</code>) \u0628\u0641\u0631\u0633\u062A\u06CC\u062F \u062A\u0627 \u062A\u0644\u0627\u0634 \u06A9\u0646\u0645. \u0644\u063A\u0648: /cancel`);
      }
      d.plan = plan;
      if (!plan.times.length && !plan.onceAt) {
        await setSession(env, uid, "ag_when", d);
        return void await send(env, uid, "\u062F\u0631 \u062F\u0633\u062A\u0648\u0631\u062A\u0627\u0646 \u0633\u0627\u0639\u062A\u06CC \u067E\u06CC\u062F\u0627 \u0646\u06A9\u0631\u062F\u0645.\n" + WHEN_HELP);
      }
      return confirm(env, uid, d);
    }
    case "ag_when": {
      const t = parseTimes(text);
      if (!t) return void await send(env, uid, "\u274C \u0633\u0627\u0639\u062A \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A.\n" + WHEN_HELP);
      if (t === "now") d.plan.onceAt = now() + 60;
      else {
        d.plan.times = t;
        d.plan.onceAt = null;
      }
      return confirm(env, uid, d);
    }
    case "ag_e_instr":
    case "ag_e_footer":
    case "ag_e_times": {
      const j = await getJob(env, d.job_id);
      if (!j || j.user_id !== uid) return void await clearSession(env, uid);
      if (state === "ag_e_instr") {
        if (text.length < 10 || text.length > 2e3) return void await send(env, uid, "\u062F\u0633\u062A\u0648\u0631 \u0628\u0627\u06CC\u062F \u0628\u06CC\u0646 \u06F1\u06F0 \u062A\u0627 \u06F2\u06F0\u06F0\u06F0 \u0646\u0648\u06CC\u0633\u0647 \u0628\u0627\u0634\u062F.");
        await env.DB.prepare("UPDATE agent_jobs SET instruction=? WHERE id=?").bind(text, j.id).run();
      } else if (state === "ag_e_footer") {
        await env.DB.prepare("UPDATE agent_jobs SET footer=? WHERE id=?").bind(text === "-" ? "" : text.slice(0, 500), j.id).run();
      } else {
        const t = parseTimes(text);
        if (!t) return void await send(env, uid, "\u274C \u0633\u0627\u0639\u062A \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A.\n" + WHEN_HELP);
        if (t === "now") await env.DB.prepare("UPDATE agent_jobs SET once_at=?, times='[]', days=NULL, last_key='', enabled=1 WHERE id=?").bind(now() + 60, j.id).run();
        else await env.DB.prepare("UPDATE agent_jobs SET times=?, days=NULL, once_at=NULL, last_key=?, attempts=0, retry_at=NULL WHERE id=?").bind(JSON.stringify(t), slotKey(now()), j.id).run();
      }
      await clearSession(env, uid);
      return show(env, uid, await getJob(env, j.id));
    }
  }
}
async function onCallback(c, user, admin, q, act, arg, s) {
  const { env } = c, uid = user.id, mid = q.message?.message_id;
  const ans = (t = "", alert = false) => answer(env, q.id, t, alert);
  if (!await llmReady(env)) return ans("\u0627\u06CC\u062C\u0646\u062A \u0647\u0646\u0648\u0632 \u0641\u0639\u0627\u0644 \u0646\u0634\u062F\u0647 \u0627\u0633\u062A.", true);
  if (act === "new") {
    await ans();
    const list = await userChannels(env, uid);
    if (!user.eitaa_token_enc) return void await send(env, uid, "\u0627\u0628\u062A\u062F\u0627 \u0627\u0632 \xAB\u0628\u0631\u0646\u0627\u0645\u0647\u200C\u0647\u0627\u06CC \u0645\u062A\u0635\u0644\xBB \u062A\u0648\u06A9\u0646 \u0627\u06CC\u062A\u0627\u06CC\u0627\u0631 \u0631\u0627 \u062B\u0628\u062A \u06A9\u0646\u06CC\u062F.");
    if (!list.length) return void await send(env, uid, "\u0627\u0628\u062A\u062F\u0627 \u0627\u0632 \xAB\u06A9\u0627\u0646\u0627\u0644\u200C\u0647\u0627\xBB \u06A9\u0627\u0646\u0627\u0644 \u062E\u0648\u062F\u062A\u0627\u0646 \u0631\u0627 \u0627\u0636\u0627\u0641\u0647 \u06A9\u0646\u06CC\u062F.");
    if ((await userJobs(env, uid)).length >= MAX_JOBS) return void await send(env, uid, `\u062D\u062F\u0627\u06A9\u062B\u0631 ${MAX_JOBS} \u0627\u06CC\u062C\u0646\u062A \u0645\u062C\u0627\u0632 \u0627\u0633\u062A.`);
    if (list.length === 1) return askInstruction(env, uid, { channel_id: list[0].id });
    return void await send(env, uid, "\u0627\u06CC\u062C\u0646\u062A \u062F\u0631 \u06A9\u062F\u0627\u0645 \u06A9\u0627\u0646\u0627\u0644 \u0634\u0645\u0627 \u067E\u0633\u062A \u0628\u06AF\u0630\u0627\u0631\u062F\u061F", ikb(list.map((ch) => [[`\u{1F7E0} ${ch.title}`.slice(0, 40), `ag:nc:${ch.id}`]])));
  }
  if (act === "nc") {
    await ans();
    const ch = await getChannel(env, Number(arg));
    return ch && ch.user_id === uid ? askInstruction(env, uid, { channel_id: ch.id }) : void 0;
  }
  if (act === "x") {
    await clearSession(env, uid);
    await ans("\u0644\u063A\u0648 \u0634\u062F.");
    return void (mid && await edit(env, uid, mid, "\u0644\u063A\u0648 \u0634\u062F."));
  }
  if (act === "redo") {
    await ans();
    return askInstruction(env, uid, { channel_id: s.data.channel_id });
  }
  if (act === "mk") {
    if (s.state !== "ag_confirm" || !s.data.plan) return ans("\u0627\u06CC\u0646 \u067E\u06CC\u0634\u200C\u0646\u0648\u06CC\u0633 \u0645\u0646\u0642\u0636\u06CC \u0634\u062F\u0647\u061B \u062F\u0648\u0628\u0627\u0631\u0647 \xAB\u0627\u06CC\u062C\u0646\u062A \u062C\u062F\u06CC\u062F\xBB \u0628\u0632\u0646\u06CC\u062F.", true);
    if ((await userJobs(env, uid)).length >= MAX_JOBS) return ans(`\u062D\u062F\u0627\u06A9\u062B\u0631 ${MAX_JOBS} \u0627\u06CC\u062C\u0646\u062A \u0645\u062C\u0627\u0632 \u0627\u0633\u062A.`, true);
    const j2 = await createJob(env, uid, s.data);
    await clearSession(env, uid);
    await ans("\u0633\u0627\u062E\u062A\u0647 \u0634\u062F \u2705");
    if (mid) await edit(env, uid, mid, "\u2705 \u0627\u06CC\u062C\u0646\u062A \u0633\u0627\u062E\u062A\u0647 \u0634\u062F.");
    return show(env, uid, j2);
  }
  if (act === "go" || act === "no") {
    const pid = Number(arg);
    const r = act === "go" ? await env.DB.prepare("UPDATE ea_posts SET status='pending', run_at=? WHERE id=? AND user_id=? AND status='draft'").bind(now(), pid, uid).run() : await env.DB.prepare("UPDATE ea_posts SET status='canceled' WHERE id=? AND user_id=? AND status='draft'").bind(pid, uid).run();
    await ans(r.meta.changes ? act === "go" ? "\u062F\u0631 \u0635\u0641 \u0627\u0646\u062A\u0634\u0627\u0631 \u0642\u0631\u0627\u0631 \u06AF\u0631\u0641\u062A." : "\u062D\u0630\u0641 \u0634\u062F." : "\u0642\u0627\u0628\u0644 \u062A\u063A\u06CC\u06CC\u0631 \u0646\u06CC\u0633\u062A.");
    if (mid && r.meta.changes) await edit(env, uid, mid, act === "go" ? `\u{1F680} \u067E\u0633\u062A #${pid} \u062F\u0631 \u0635\u0641 \u0627\u0646\u062A\u0634\u0627\u0631 \u0627\u0633\u062A\u2026` : `\u{1F5D1} \u067E\u06CC\u0634\u200C\u0646\u0648\u06CC\u0633 #${pid} \u062D\u0630\u0641 \u0634\u062F.`);
    return;
  }
  const j = await getJob(env, Number(arg));
  if (!j || j.user_id !== uid) return ans();
  switch (act) {
    case "v":
      await ans();
      return show(env, uid, j);
    case "run":
      await env.DB.prepare("UPDATE agent_jobs SET run_now=1 WHERE id=?").bind(j.id).run();
      await ans("\u062F\u0631 \u0635\u0641 \u0627\u062C\u0631\u0627 \u0642\u0631\u0627\u0631 \u06AF\u0631\u0641\u062A.");
      return void await send(env, uid, "\u25B6\uFE0F \u0627\u06CC\u062C\u0646\u062A \u062A\u0627 \u062D\u062F\u0627\u06A9\u062B\u0631 \u06CC\u06A9 \u062F\u0642\u06CC\u0642\u0647\u200C\u06CC \u062F\u06CC\u06AF\u0631 \u0627\u062C\u0631\u0627 \u0645\u06CC\u200C\u0634\u0648\u062F \u0648 \u0646\u062A\u06CC\u062C\u0647 \u0631\u0627 \u0647\u0645\u06CC\u0646\u200C\u062C\u0627 \u0645\u06CC\u200C\u0641\u0631\u0633\u062A\u062F.");
    case "tg":
      await env.DB.prepare("UPDATE agent_jobs SET enabled=?, last_key=?, retry_at=NULL, attempts=0 WHERE id=?").bind(j.enabled ? 0 : 1, j.once_at ? j.last_key : slotKey(now()), j.id).run();
      await ans(j.enabled ? "\u0645\u062A\u0648\u0642\u0641 \u0634\u062F." : "\u0641\u0639\u0627\u0644 \u0634\u062F.");
      return show(env, uid, await getJob(env, j.id), mid);
    case "ap":
      await env.DB.prepare("UPDATE agent_jobs SET approve=? WHERE id=?").bind(j.approve ? 0 : 1, j.id).run();
      await ans();
      return show(env, uid, await getJob(env, j.id), mid);
    case "ed":
      await ans();
      await setSession(env, uid, "ag_e_instr", { job_id: j.id });
      return void await send(env, uid, "\u270F\uFE0F \u062F\u0633\u062A\u0648\u0631 \u062C\u062F\u06CC\u062F \u0631\u0627 \u0628\u0641\u0631\u0633\u062A\u06CC\u062F (\u062C\u0627\u06CC\u06AF\u0632\u06CC\u0646 \u062F\u0633\u062A\u0648\u0631 \u0641\u0639\u0644\u06CC \u0645\u06CC\u200C\u0634\u0648\u062F). \u0644\u063A\u0648: /cancel");
    case "ft":
      await ans();
      await setSession(env, uid, "ag_e_footer", { job_id: j.id });
      return void await send(env, uid, "\u{1F58B} \u0627\u0645\u0636\u0627\u06CC \u062C\u062F\u06CC\u062F \u0631\u0627 \u0628\u0641\u0631\u0633\u062A\u06CC\u062F. \u062D\u0630\u0641 \u0627\u0645\u0636\u0627: <code>-</code>");
    case "tm":
      await ans();
      await setSession(env, uid, "ag_e_times", { job_id: j.id });
      return void await send(env, uid, WHEN_HELP);
    case "del":
      await ans();
      return void await send(env, uid, `\u0627\u06CC\u062C\u0646\u062A \xAB${esc(j.name)}\xBB \u062D\u0630\u0641 \u0634\u0648\u062F\u061F`, ikb([[["\u2705 \u0628\u0644\u0647\u060C \u062D\u0630\u0641", `ag:dy:${j.id}`], ["\u062E\u06CC\u0631", `ag:v:${j.id}`]]]));
    case "dy":
      await env.DB.batch([
        env.DB.prepare("UPDATE ea_posts SET status='canceled' WHERE job_id=? AND status IN ('pending','draft')").bind(j.id),
        env.DB.prepare("DELETE FROM agent_seen WHERE job_id=?").bind(j.id),
        env.DB.prepare("DELETE FROM agent_jobs WHERE id=?").bind(j.id)
      ]);
      await ans("\u062D\u0630\u0641 \u0634\u062F.");
      return void (mid && await edit(env, uid, mid, "\u{1F5D1} \u0627\u06CC\u062C\u0646\u062A \u062D\u0630\u0641 \u0634\u062F."));
  }
}

// eitaa-src/scheduler.ts
var sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
var MAX_IMG = 15 * 1024 * 1024;
async function fileBytes(env, p) {
  if (p.src_url) {
    const f = await fetchBytes(p.src_url, MAX_IMG, eitaaWeb(env) + "/");
    return { bytes: f.bytes, name: p.file_name || `image.${extFor(f.type, p.src_url)}` };
  }
  return { bytes: await download(env, p.file_id), name: p.file_name || "file" };
}
async function sendOnce(env, token, p, ch) {
  const o = { title: p.title || void 0, silent: !!p.silent, pin: !!p.pin, viewDelete: p.view_delete || void 0 };
  let res;
  if (p.kind === "text") res = await sendMessage(env, token, ch.chat_id, p.text, o);
  else {
    const f = await fileBytes(env, p);
    res = await sendFile(env, token, ch.chat_id, f.name, f.bytes, p.text, o);
  }
  const id = res && (res.message_id ?? res.id ?? res.result?.message_id);
  return id ? String(id) : "";
}
async function deliver(env, postId, quiet = false) {
  const claim = await env.DB.prepare("UPDATE ea_posts SET status='sending', claimed_at=? WHERE id=? AND status='pending'").bind(now(), postId).run();
  if (!claim.meta.changes) return;
  const p = await env.DB.prepare("SELECT * FROM ea_posts WHERE id=?").bind(postId).first();
  const user = await env.DB.prepare("SELECT * FROM ea_users WHERE id=?").bind(p.user_id).first();
  const ch = await env.DB.prepare("SELECT * FROM ea_channels WHERE id=?").bind(p.channel_id).first();
  const fail = async (msg) => {
    await env.DB.prepare("UPDATE ea_posts SET status='failed', error=? WHERE id=?").bind(msg.slice(0, 300), p.id).run();
    if (!quiet) await send(env, p.user_id, `\u274C \u0627\u0631\u0633\u0627\u0644 \u067E\u0633\u062A #${p.id} \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062F:
${esc(msg)}`);
  };
  if (!user || !ch) return fail("\u06A9\u0627\u0631\u0628\u0631 \u06CC\u0627 \u06A9\u0627\u0646\u0627\u0644 \u062F\u06CC\u06AF\u0631 \u0648\u062C\u0648\u062F \u0646\u062F\u0627\u0631\u062F.");
  const token = await dec(env.SECRET_KEY, user.eitaa_token_enc);
  if (!token) return fail("\u062A\u0648\u06A9\u0646 \u0627\u06CC\u062A\u0627\u06CC\u0627\u0631 \u062B\u0628\u062A \u0646\u0634\u062F\u0647 \u06CC\u0627 \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A. \u0622\u0646 \u0631\u0627 \u062F\u0648\u0628\u0627\u0631\u0647 \u062F\u0631 \xAB\u0628\u0631\u0646\u0627\u0645\u0647\u200C\u0647\u0627\u06CC \u0645\u062A\u0635\u0644\xBB \u062B\u0628\u062A \u06A9\u0646\u06CC\u062F.");
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const mid = await sendOnce(env, token, p, ch);
      await env.DB.prepare("UPDATE ea_posts SET status='sent', sent_at=?, eitaa_message_id=?, error='' WHERE id=?").bind(now(), mid, p.id).run();
      if (!quiet) await send(env, p.user_id, `\u2705 \u067E\u0633\u062A #${p.id} \u062F\u0631 \u{1F7E0} \xAB${esc(ch.title)}\xBB \u0627\u0631\u0633\u0627\u0644 \u0634\u062F.`);
      return;
    } catch (e) {
      last = e.message;
      if (!(e instanceof EitaaNetworkError) || attempt === 2) break;
      await sleep2(2e3 * (attempt + 1));
    }
  }
  await fail(last || "\u062E\u0637\u0627\u06CC \u0646\u0627\u0645\u0634\u062E\u0635");
}
async function tick(env) {
  const t = now();
  await env.DB.prepare("UPDATE ea_posts SET status='failed', error='\u0627\u0631\u0633\u0627\u0644 \u0646\u06CC\u0645\u0647\u200C\u06A9\u0627\u0631\u0647 \u0645\u0627\u0646\u062F\u061B \u0644\u0637\u0641\u0627\u064B \u062F\u0648\u0628\u0627\u0631\u0647 \u0632\u0645\u0627\u0646\u200C\u0628\u0646\u062F\u06CC \u06A9\u0646\u06CC\u062F.' WHERE status='sending' AND claimed_at < ?").bind(t - 900).run();
  const due = (await env.DB.prepare("SELECT id FROM ea_posts WHERE status='pending' AND run_at<=? ORDER BY run_at LIMIT 3").bind(t).all()).results;
  for (const d of due) {
    try {
      await deliver(env, d.id);
    } catch (e) {
      console.error("deliver failed", d.id, e.message);
    }
  }
  try {
    await agentTick(env);
  } catch (e) {
    console.error("agent tick failed", e.message);
  }
}

// eitaa-src/chat.ts
var MAX_STEPS2 = 6;
var BUDGET_MS = 42e3;
var STEP_TIMEOUT_MS = 2e4;
var HIST_KEEP = 6;
var INTRO = "\u{1F4AC} <b>\u06AF\u0641\u062A\u06AF\u0648\u06CC \u0632\u0646\u062F\u0647 \u0628\u0627 \u0627\u06CC\u062C\u0646\u062A</b>\n\n\u0647\u0631 \u0686\u0647 \u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u06CC\u062F \u0628\u0646\u0648\u06CC\u0633\u06CC\u062F\u061B \u0647\u0645\u0627\u0646 \u0644\u062D\u0638\u0647 \u0627\u0646\u062C\u0627\u0645 \u0645\u06CC\u200C\u062F\u0647\u062F \u0648 \u0646\u062A\u06CC\u062C\u0647\u200C\u06CC \u0648\u0627\u0642\u0639\u06CC \u0631\u0627 \u0645\u06CC\u200C\u06AF\u0648\u06CC\u062F. \u0645\u062B\u0644\u0627\u064B:\n\u2022 <i>\u0628\u0631\u0627\u06CC \u062A\u0633\u062A \u06CC\u06A9 \xAB\u0633\u0644\u0627\u0645\xBB \u062A\u0648\u06CC \u06A9\u0627\u0646\u0627\u0644\u0645 \u0628\u0641\u0631\u0633\u062A</i>\n\u2022 <i>\u0627\u0632 \u06A9\u0627\u0646\u0627\u0644 @name \u0622\u062E\u0631\u06CC\u0646 \u067E\u0633\u062A\u200C\u0647\u0627 \u0631\u0627 \u0646\u0634\u0627\u0646\u0645 \u0628\u062F\u0647</i>\n\u2022 <i>\u0627\u0632 @name \u06CC\u06A9 \u0627\u0633\u062A\u06CC\u06A9\u0631 \u062A\u0642\u0648\u06CC\u0645 \u067E\u06CC\u062F\u0627 \u06A9\u0646 \u0648 \u0628\u0641\u0631\u0633\u062A</i>\n\u2022 <i>\u0641\u0631\u062F\u0627 \u0633\u0627\u0639\u062A \u06F9 \u0627\u06CC\u0646 \u0645\u062A\u0646 \u0631\u0627 \u0628\u06AF\u0630\u0627\u0631: \u2026</i>\n\n\u062E\u0631\u0648\u062C: /cancel \u06CC\u0627 \u0647\u0631 \u062F\u06A9\u0645\u0647\u200C\u06CC \u0645\u0646\u0648.";
async function start(env, u) {
  if (!await llmReady(env)) return void await send(env, u.id, "\u23F3 \u0627\u06CC\u062C\u0646\u062A \u0647\u0646\u0648\u0632 \u0641\u0639\u0627\u0644 \u0646\u0634\u062F\u0647 \u0627\u0633\u062A (\u0628\u0627\u06CC\u0646\u062F\u06CC\u0646\u06AF AI \u062F\u0631 wrangler.jsonc \u0641\u0639\u0627\u0644 \u0646\u06CC\u0633\u062A).");
  if (!u.eitaa_token_enc) return void await send(env, u.id, "\u0627\u0628\u062A\u062F\u0627 \u0627\u0632 \xAB\u0628\u0631\u0646\u0627\u0645\u0647\u200C\u0647\u0627\u06CC \u0645\u062A\u0635\u0644\xBB \u062A\u0648\u06A9\u0646 \u0627\u06CC\u062A\u0627\u06CC\u0627\u0631 \u0631\u0627 \u062B\u0628\u062A \u06A9\u0646\u06CC\u062F.");
  if (!(await userChannels(env, u.id)).length) return void await send(env, u.id, "\u0627\u0628\u062A\u062F\u0627 \u0627\u0632 \xAB\u06A9\u0627\u0646\u0627\u0644\u200C\u0647\u0627\xBB \u06A9\u0627\u0646\u0627\u0644 \u062E\u0648\u062F\u062A\u0627\u0646 \u0631\u0627 \u0627\u0636\u0627\u0641\u0647 \u06A9\u0646\u06CC\u062F.");
  await setSession(env, u.id, "chat", { hist: [], last_mid: 0, busy_until: 0 });
  await send(env, u.id, INTRO);
}
var TOOLS2 = [
  { type: "function", function: {
    name: "read_channel",
    description: "Latest posts of a PUBLIC Eitaa channel (@id), newest first, short previews (ref, text; image/sticker=1).",
    parameters: { type: "object", properties: { channel: { type: "string" } }, required: ["channel"] }
  } },
  { type: "function", function: {
    name: "send_to_me",
    description: 'Show/send something to HIM in this Telegram chat (NOT to any channel): use for "show me / send me / \u0628\u0631\u0627\u0645 \u0628\u0641\u0631\u0633\u062A / \u0646\u0634\u0627\u0646\u0645 \u0628\u062F\u0647". Pass from_ref (full post text) and/or image_ref, or your own text.',
    parameters: { type: "object", properties: { text: { type: "string" }, from_ref: { type: "string" }, image_ref: { type: "string" } } }
  } },
  { type: "function", function: {
    name: "post_to_channel",
    description: 'PUBLISH to one of HIS OWN channels NOW, only when he explicitly asks to post/publish/send something into his channel (\u06A9\u0627\u0646\u0627\u0644\u0645). Never for "send me". The text must be real post content, never an instruction (real result is returned). To forward a source post pass from_ref (full text copied by the system) and/or image_ref (image or sticker; for a sticker omit text).',
    parameters: { type: "object", properties: { text: { type: "string" }, from_ref: { type: "string" }, image_ref: { type: "string" }, channel_id: { type: "integer", description: "optional if he has one channel" } } }
  } },
  { type: "function", function: {
    name: "schedule_post",
    description: 'Schedule a text post. when: "18:30", "\u0641\u0631\u062F\u0627 09:00", "+45" (minutes), "1405/07/20 18:30" (Tehran).',
    parameters: { type: "object", properties: { text: { type: "string" }, when: { type: "string" }, channel_id: { type: "integer" } }, required: ["text", "when"] }
  } }
];
async function turn(c, user, m, text, data) {
  const { env } = c, uid = user.id, t0 = Date.now();
  if (!text) return void await send(env, uid, "\u062F\u0631 \u06AF\u0641\u062A\u06AF\u0648 \u0641\u0639\u0644\u0627\u064B \u0641\u0642\u0637 \u067E\u06CC\u0627\u0645 \u0645\u062A\u0646\u06CC \u0645\u06CC\u200C\u0641\u0647\u0645\u0645. (\u0628\u0631\u0627\u06CC \u0627\u0631\u0633\u0627\u0644 \u0641\u0627\u06CC\u0644 \u0627\u0632 \xAB\u270D\uFE0F \u067E\u0633\u062A \u062C\u062F\u06CC\u062F\xBB \u0627\u0633\u062A\u0641\u0627\u062F\u0647 \u06A9\u0646\u06CC\u062F.)");
  if (m.message_id <= (data.last_mid || 0)) return;
  if ((data.busy_until || 0) > now()) return void await send(env, uid, "\u23F3 \u0647\u0646\u0648\u0632 \u062F\u0627\u0631\u0645 \u067E\u06CC\u0627\u0645 \u0642\u0628\u0644\u06CC \u0631\u0627 \u0627\u0646\u062C\u0627\u0645 \u0645\u06CC\u200C\u062F\u0647\u0645\u061B \u0686\u0646\u062F \u062B\u0627\u0646\u06CC\u0647 \u0635\u0628\u0631 \u06A9\u0646\u06CC\u062F.");
  await setSession(env, uid, "chat", { ...data, last_mid: m.message_id, busy_until: now() + 70 });
  await typing(env, uid);
  const mid = await send(env, uid, "\u{1F914} \u2026");
  const show2 = (t) => mid ? edit(env, uid, mid, t) : Promise.resolve();
  const chans = await userChannels(env, uid);
  const st = { channels: /* @__PURE__ */ new Map(), refs: /* @__PURE__ */ new Map() };
  const tnow = now(), l = toLocal(tnow);
  const system = `LIVE CHAT RULES. You are the live assistant of an Eitaa channel owner; chat in Persian, briefly. Act with tools immediately when he clearly asks (send, test message, read a channel, forward a sticker\u2026); ask ONE short question only if something essential is missing. IMPORTANT: "\u0628\u0631\u0627\u0645/\u0648\u0627\u0633\u0645/\u0628\u0647\u0645/\u0646\u0634\u0627\u0646\u0645 \u0628\u062F\u0647/\u0628\u0647 \u0645\u0646 \u0628\u0641\u0631\u0633\u062A" = show it to HIM in this chat \u2192 read_channel then send_to_me. Use post_to_channel ONLY when he clearly says to put/post/send into HIS channel (\u06A9\u0627\u0646\u0627\u0644\u0645\u060C \u062A\u0648\u06CC \u06A9\u0627\u0646\u0627\u0644 \u0645\u0646). A channel he merely names (@x) is a source to read, not a destination. Post exactly the text he asks, no signature unless asked. Only PUBLIC channels he names can be read (no global search). Use from_ref/image_ref to forward posts instead of retyping. Today (Tehran): ${jalaliLong(tnow)} | ${l.y}-${pad2(l.mo)}-${pad2(l.d)} ${pad2(l.h)}:${pad2(l.mi)}
HIS CHANNELS: ${chans.map((x) => `id=${x.id} \xAB${x.title}\xBB (@${x.chat_id})`).join("; ")}`;
  const hist = Array.isArray(data.hist) ? data.hist : [];
  const messages = [{ role: "system", content: system }, ...hist.map((h) => ({ role: h.r === "u" ? "user" : "assistant", content: h.t })), { role: "user", content: text }];
  const pick = (id) => {
    if (id === void 0 || id === null || id === "") return chans.length === 1 ? chans[0] : "specify channel_id (he has several channels: ask him which one)";
    return chans.find((x) => x.id === Number(id)) || "unknown channel_id";
  };
  const insert = async (ch, kind, body, file, name, runAt) => (await env.DB.prepare("INSERT INTO ea_posts(user_id,channel_id,kind,text,file_id,file_name,title,silent,pin,view_delete,run_at,status,created_at,src_url) VALUES(?,?,?,?,'',?,'',0,0,0,?,'pending',?,?)").bind(uid, ch.id, kind, body, name, runAt, now(), file).run()).meta.last_row_id;
  const toMe = /(واسم|برام|برایم|بهم|نشانم|نشونم|به من|برای من|بفرست برام)/.test(text) && !/(کانالم|کانال من|کانال خودم|داخل کانال من|توی کانال من)/.test(text);
  const tools = toMe ? TOOLS2.filter((x) => x.function.name !== "post_to_channel" && x.function.name !== "schedule_post") : TOOLS2;
  const notes = [];
  const exec = async (name, a) => {
    switch (name) {
      case "read_channel": {
        await show2(`\u{1F50E} \u062F\u0631 \u062D\u0627\u0644 \u062E\u0648\u0627\u0646\u062F\u0646 @${esc(String(a.channel || ""))}\u2026`);
        return readChannel(env, st, a, null, 4);
      }
      case "send_to_me": {
        const p = resolvePost(st, a, "");
        if ("error" in p) return { status: "failed", error: p.error };
        try {
          if (p.sticker && p.image) await tg(env, "sendSticker", { chat_id: uid, sticker: p.image });
          else if (p.image) await tg(env, "sendPhoto", { chat_id: uid, photo: p.image, caption: p.text.slice(0, 1e3) });
          else await send(env, uid, esc(p.text));
          if (p.image && !p.sticker && p.text.length > 1e3) await send(env, uid, esc(p.text));
        } catch (e) {
          if (p.text) await send(env, uid, esc(p.text));
          else return { status: "failed", error: e.message };
        }
        notes.push("\u{1F4E8} \u0628\u0631\u0627\u06CC \u0634\u0645\u0627 \u0641\u0631\u0633\u062A\u0627\u062F\u0647 \u0634\u062F.");
        return { status: "sent_to_user" };
      }
      case "post_to_channel": {
        const ch = pick(a.channel_id);
        if (typeof ch === "string") return { status: "failed", error: ch };
        const p = resolvePost(st, a, "");
        if ("error" in p) return { status: "failed", error: p.error };
        await show2(`\u{1F4E4} \u062F\u0631 \u062D\u0627\u0644 \u0627\u0631\u0633\u0627\u0644 \u0628\u0647 \xAB${esc(ch.title)}\xBB\u2026`);
        const id = await insert(ch, p.image ? "file" : "text", p.text, p.image, p.sticker ? "sticker.webp" : "", now());
        await deliver(env, id, true);
        const r = await env.DB.prepare("SELECT status, error FROM ea_posts WHERE id=?").bind(id).first();
        const ok = r?.status === "sent";
        notes.push(ok ? `\u2705 ${p.sticker ? "\u0627\u0633\u062A\u06CC\u06A9\u0631" : "\u067E\u06CC\u0627\u0645"} \u062F\u0631 \xAB${esc(ch.title)}\xBB \u0627\u0631\u0633\u0627\u0644 \u0634\u062F.` : `\u274C \u0627\u0631\u0633\u0627\u0644 \u0628\u0647 \xAB${esc(ch.title)}\xBB \u0646\u0634\u062F: ${esc(r?.error || "\u062E\u0637\u0627\u06CC \u0646\u0627\u0645\u0634\u062E\u0635")}`);
        return ok ? { status: "sent" } : { status: "failed", error: r?.error || "unknown error" };
      }
      case "schedule_post": {
        const ch = pick(a.channel_id);
        if (typeof ch === "string") return { status: "failed", error: ch };
        const at = parseWhen(String(a.when || ""));
        const body = String(a.text || "").trim();
        if (at === null) return { status: "failed", error: "invalid or past time; use 18:30, \u0641\u0631\u062F\u0627 09:00, +45, 1405/07/20 18:30" };
        if (!body || body.length > 3900) return { status: "failed", error: "empty or too long text" };
        await insert(ch, "text", body, "", "", at);
        notes.push(`\u23F0 \u0628\u0631\u0627\u06CC ${fmtDt(at)} (\u0648\u0642\u062A \u062A\u0647\u0631\u0627\u0646) \u062F\u0631 \xAB${esc(ch.title)}\xBB \u0632\u0645\u0627\u0646\u200C\u0628\u0646\u062F\u06CC \u0634\u062F.`);
        return { status: "scheduled" };
      }
    }
    return { error: `unknown tool ${name}` };
  };
  let answer2 = "", failedWhy = "";
  try {
    for (let step = 0; step < MAX_STEPS2; step++) {
      if (Date.now() - t0 > BUDGET_MS) {
        answer2 = "\u23F1 \u0632\u0645\u0627\u0646 \u0627\u06CC\u0646 \u062F\u0631\u062E\u0648\u0627\u0633\u062A \u062A\u0645\u0627\u0645 \u0634\u062F\u061B \u0627\u06AF\u0631 \u06A9\u0627\u0631 \u06A9\u0627\u0645\u0644 \u0646\u0634\u062F \u062F\u0648\u0628\u0627\u0631\u0647 \u0628\u06AF\u0648\u06CC\u06CC\u062F.";
        break;
      }
      const r = await chatTools(env, messages, tools, STEP_TIMEOUT_MS, 700);
      messages.push(r);
      if (!r.tool_calls?.length) {
        answer2 = esc((r.content || "").trim());
        break;
      }
      let onlyActions = true;
      for (const call2 of r.tool_calls) {
        if (call2.function.name === "read_channel") onlyActions = false;
        let out;
        try {
          out = await exec(call2.function.name, JSON.parse(call2.function.arguments || "{}"));
        } catch (e) {
          out = { error: e.message };
        }
        messages.push({ role: "tool", tool_call_id: call2.id, content: JSON.stringify(out).slice(0, 12e3) });
      }
      if (onlyActions && notes.length) {
        answer2 = (r.content ? esc(r.content.trim()) + "\n" : "") + notes.join("\n");
        break;
      }
    }
  } catch (e) {
    failedWhy = e.message;
  }
  const final = failedWhy ? `\u274C ${esc(failedWhy)}` : (notes.length && !answer2.includes(notes[0]) ? [answer2, ...notes] : [answer2 || "\u0627\u0646\u062C\u0627\u0645 \u0634\u062F."]).filter(Boolean).join("\n");
  if (mid) await edit(env, uid, mid, final.slice(0, 4e3));
  else await send(env, uid, final);
  const keep = [...hist, { r: "u", t: text.slice(0, 300) }, { r: "a", t: (failedWhy ? `(\u062E\u0637\u0627: ${failedWhy})` : notes.length ? notes.join(" ") : answer2).replace(/<[^>]+>/g, "").slice(0, 300) }].slice(-HIST_KEEP);
  const cur = await getSession(env, uid);
  if (cur.state === "chat") await setSession(env, uid, "chat", { hist: keep, last_mid: m.message_id, busy_until: 0 });
}

// eitaa-src/bot.ts
var B = { NEW: "\u270D\uFE0F \u067E\u0633\u062A \u062C\u062F\u06CC\u062F", SCHED: "\u23F0 \u0632\u0645\u0627\u0646\u200C\u0628\u0646\u062F\u06CC\u200C\u0634\u062F\u0647\u200C\u0647\u0627", AGENT: "\u{1F916} \u0627\u06CC\u062C\u0646\u062A \u0647\u0648\u0634\u0645\u0646\u062F", CHAT: "\u{1F4AC} \u06AF\u0641\u062A\u06AF\u0648 \u0628\u0627 \u0627\u06CC\u062C\u0646\u062A", CHAN: "\u{1F4E3} \u06A9\u0627\u0646\u0627\u0644\u200C\u0647\u0627", APPS: "\u{1F50C} \u0628\u0631\u0646\u0627\u0645\u0647\u200C\u0647\u0627\u06CC \u0645\u062A\u0635\u0644", ME: "\u{1F464} \u062D\u0633\u0627\u0628 \u0645\u0646", HELP: "\u{1F4A1} \u0631\u0627\u0647\u0646\u0645\u0627", ADMIN: "\u{1F6E0} \u0645\u062F\u06CC\u0631\u06CC\u062A", BACK: "\u{1F519} \u0628\u0627\u0632\u06AF\u0634\u062A \u0628\u0647 \u0647\u0648\u0634 \u0645\u0635\u0646\u0648\u0639\u06CC" };
var MENU = new Set(Object.values(B));
var MAX_FILE = 20 * 1024 * 1024;
var MAX_CHANNELS = 20;
var mainKb = (admin) => ({
  keyboard: [[{ text: B.NEW }, { text: B.SCHED }], [{ text: B.CHAT }, { text: B.AGENT }], [{ text: B.CHAN }, { text: B.APPS }], [{ text: B.ME }, { text: B.HELP }], [{ text: B.BACK }, ...admin ? [{ text: B.ADMIN }] : []]],
  resize_keyboard: true
});
var isAdmin = (env, uid) => adminIds(env).includes(uid);
var hasAccess = (u, admin, env) => admin || !!env?.EA_ACCESS || !!u.expires_at && u.expires_at > now();
var NO_ACCESS = "\u{1F512} \u0627\u0634\u062A\u0631\u0627\u06A9 \u0641\u0639\u0627\u0644 \u0646\u062F\u0627\u0631\u06CC\u062F.\n\u0628\u0631\u0627\u06CC \u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC \u0628\u0627 \u0645\u062F\u06CC\u0631 \u062A\u0645\u0627\u0633 \u0628\u06AF\u06CC\u0631\u06CC\u062F.";
async function handleUpdate(c, u) {
  if (u.callback_query) return onCallback2(c, u.callback_query);
  if (u.message && u.message.chat.type === "private" && u.message.from) return onMessage(c, u.message);
}
async function onMessage(c, m) {
  const { env } = c, uid = m.from.id, admin = isAdmin(env, uid);
  const user = await touchUser(env, uid, m.from.first_name || "", m.from.username || "");
  if (user.banned && !admin) return void await send(env, uid, "\u26D4\uFE0F \u062F\u0633\u062A\u0631\u0633\u06CC \u0634\u0645\u0627 \u0645\u0633\u062F\u0648\u062F \u0634\u062F\u0647 \u0627\u0633\u062A.");
  const text = (m.text || "").trim();
  if (text.startsWith("/")) {
    const [cmd, ...args] = text.split(/\s+/);
    switch (cmd.split("@")[0].toLowerCase()) {
      case "/start":
        await clearSession(env, uid);
        return void await send(env, uid, welcome(env, user, admin), mainKb(admin));
      case "/cancel":
        await clearSession(env, uid);
        return void await send(env, uid, "\u0644\u063A\u0648 \u0634\u062F.", mainKb(admin));
      case "/help":
        return void await send(env, uid, HELP, mainKb(admin));
      default:
        if (admin) {
          const r = await adminCmd(env, cmd.toLowerCase(), args);
          if (r) return void await send(env, uid, r);
        }
    }
    return void await send(env, uid, "\u062F\u0633\u062A\u0648\u0631 \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A. /help");
  }
  if (MENU.has(text)) {
    await clearSession(env, uid);
    return menu(c, user, admin, text);
  }
  const s = await getSession(env, uid);
  if (!hasAccess(user, admin, env) && s.state) {
    await clearSession(env, uid);
    return void await send(env, uid, NO_ACCESS);
  }
  switch (s.state) {
    case "token":
      return gotToken(c, user, m, text);
    case "chan_id":
      return gotChanId(c, user, text);
    case "chan_title":
      return gotChanTitle(c, user, s.data, text);
    case "chan_rename":
      return gotRename(c, user, s.data, text);
    case "np_content":
      return gotContent(c, user, s.data, m);
    case "np_title":
      return gotNpField(c, user, s.data, "title", text);
    case "np_view":
      return gotNpField(c, user, s.data, "view", text);
    case "np_when":
      return gotWhen(c, user, s.data, text);
  }
  if (s.state === "chat") return turn(c, user, m, text, s.data);
  if (s.state.startsWith("ag_")) return onText(c, user, admin, s.state, s.data, text);
  await send(env, uid, "\u0627\u0632 \u0645\u0646\u0648\u06CC \u067E\u0627\u06CC\u06CC\u0646 \u0627\u0633\u062A\u0641\u0627\u062F\u0647 \u06A9\u0646\u06CC\u062F.", mainKb(admin));
}
async function menu(c, user, admin, text) {
  const { env } = c, uid = user.id;
  if (text === B.HELP) return void await send(env, uid, HELP, mainKb(admin));
  if (text === B.ADMIN) return admin ? adminPanel(env, uid) : void 0;
  if (!hasAccess(user, admin, env)) return void await send(env, uid, NO_ACCESS);
  switch (text) {
    case B.NEW:
      return newPost(c, user);
    case B.SCHED:
      return scheduled(env, uid);
    case B.AGENT:
      return home(env, user);
    case B.CHAT:
      return start(env, user);
    case B.CHAN:
      return channels(env, uid);
    case B.APPS:
      return apps(env, user);
    case B.ME:
      return account(env, user, admin);
  }
}
var welcome = (env, u, admin) => `\u0633\u0644\u0627\u0645 ${esc(u.name || "")} \u{1F44B}

\u2728 \u067E\u0633\u062A \u0641\u0648\u0631\u06CC\u060C \u0632\u0645\u0627\u0646\u200C\u0628\u0646\u062F\u06CC\u200C\u0634\u062F\u0647 \u0648 \u0627\u06CC\u062C\u0646\u062A \u0647\u0648\u0634\u0645\u0646\u062F \u0628\u0631\u0627\u06CC \u06A9\u0627\u0646\u0627\u0644\u200C\u0647\u0627\u06CC <b>\u0627\u06CC\u062A\u0627</b>\u060C \u0627\u0632 \u0647\u0645\u06CC\u0646\u200C\u062C\u0627.

` + (hasAccess(u, admin, env) ? "\u0627\u0632 \u0645\u0646\u0648\u06CC \u067E\u0627\u06CC\u06CC\u0646 \u0634\u0631\u0648\u0639 \u06A9\u0646\u06CC\u062F \u{1F447}" : NO_ACCESS);
var HELP = "<b>\u{1F4A1} \u0631\u0627\u0647\u0646\u0645\u0627</b>\n\n1\uFE0F\u20E3 <b>\u0628\u0631\u0646\u0627\u0645\u0647\u200C\u0647\u0627\u06CC \u0645\u062A\u0635\u0644</b>: \u062A\u0648\u06A9\u0646 \u0627\u06CC\u062A\u0627\u06CC\u0627\u0631 \u0631\u0627 \u062B\u0628\u062A \u06A9\u0646\u06CC\u062F\n2\uFE0F\u20E3 <b>\u06A9\u0627\u0646\u0627\u0644\u200C\u0647\u0627</b>: \u06A9\u0627\u0646\u0627\u0644 \u0631\u0627 \u0627\u0636\u0627\u0641\u0647 \u06A9\u0646\u06CC\u062F (\u062D\u0633\u0627\u0628 \u06CC\u0627 \u0631\u0628\u0627\u062A \u0628\u0627\u06CC\u062F \u062F\u0631 \u06A9\u0627\u0646\u0627\u0644 \u0627\u062F\u0645\u06CC\u0646 \u0628\u0627\u0634\u062F)\n3\uFE0F\u20E3 <b>\u067E\u0633\u062A \u062C\u062F\u06CC\u062F</b>: \u06A9\u0627\u0646\u0627\u0644 \u0631\u0627 \u0627\u0646\u062A\u062E\u0627\u0628 \u0648 \u0645\u062A\u0646 \u06CC\u0627 \u0641\u0627\u06CC\u0644 (\u062A\u0627 \u06F2\u06F0 \u0645\u06AF\u0627\u0628\u0627\u06CC\u062A) \u0631\u0627 \u0628\u0641\u0631\u0633\u062A\u06CC\u062F\u061B \u0633\u067E\u0633 \u0627\u0631\u0633\u0627\u0644 \u06CC\u0627 \u0632\u0645\u0627\u0646\u200C\u0628\u0646\u062F\u06CC\n\n\u{1F4AC} <b>\u06AF\u0641\u062A\u06AF\u0648 \u0628\u0627 \u0627\u06CC\u062C\u0646\u062A</b>: \u0632\u0646\u062F\u0647 \u0628\u0627 \u0627\u06CC\u062C\u0646\u062A \u062D\u0631\u0641 \u0628\u0632\u0646\u06CC\u062F\u061B \u0647\u0645\u0627\u0646 \u0644\u062D\u0638\u0647 \u06A9\u0627\u0631 \u0631\u0627 \u0627\u0646\u062C\u0627\u0645 \u0645\u06CC\u200C\u062F\u0647\u062F \u0648 \u0646\u062A\u06CC\u062C\u0647 \u0631\u0627 \u0645\u06CC\u200C\u06AF\u0648\u06CC\u062F\n\u{1F916} <b>\u0627\u06CC\u062C\u0646\u062A \u0647\u0648\u0634\u0645\u0646\u062F</b>: \u0628\u0627 \u0632\u0628\u0627\u0646 \u0633\u0627\u062F\u0647 \u0628\u06AF\u0648\u06CC\u06CC\u062F \u0686\u0647 \u06A9\u0627\u0631\u06CC \u0648 \u0686\u0647 \u0633\u0627\u0639\u062A\u06CC \u0627\u0646\u062C\u0627\u0645 \u0634\u0648\u062F (\u0645\u062B\u0644\u0627\u064B \u0627\u0632 \u06A9\u0627\u0646\u0627\u0644\u200C\u0647\u0627\u06CC \u0639\u0645\u0648\u0645\u06CC \u0645\u062D\u062A\u0648\u0627 \u0628\u06CC\u0627\u0648\u0631\u062F \u06CC\u0627 \u0647\u0631 \u0635\u0628\u062D \u067E\u06CC\u0627\u0645 \u0635\u0628\u062D\u200C\u0628\u062E\u06CC\u0631 \u0628\u06AF\u0630\u0627\u0631\u062F)\n\n\u23F1 \u0646\u0645\u0648\u0646\u0647 \u0632\u0645\u0627\u0646: <code>18:30</code> \xB7 <code>\u0641\u0631\u062F\u0627 09:00</code> \xB7 <code>+45</code> \xB7 <code>1405/07/20 18:30</code>";
async function apps(env, u) {
  const has = !!u.eitaa_token_enc;
  const rows = [[[has ? "\u{1F511} \u062A\u063A\u06CC\u06CC\u0631 \u062A\u0648\u06A9\u0646 \u0627\u06CC\u062A\u0627\u06CC\u0627\u0631" : "\u{1F511} \u062B\u0628\u062A \u062A\u0648\u06A9\u0646 \u0627\u06CC\u062A\u0627\u06CC\u0627\u0631", "tk:set"]]];
  if (has) rows.push([["\u{1F5D1} \u062D\u0630\u0641 \u062A\u0648\u06A9\u0646 \u0627\u06CC\u062A\u0627\u06CC\u0627\u0631", "tk:del"]]);
  await send(env, u.id, `<b>\u{1F50C} \u0628\u0631\u0646\u0627\u0645\u0647\u200C\u0647\u0627\u06CC \u0645\u062A\u0635\u0644</b>

\u{1F7E0} \u0627\u06CC\u062A\u0627\u06CC\u0627\u0631: ${has ? "\u2705 \u0645\u062A\u0635\u0644" + (u.eitaa_account ? ` (${esc(u.eitaa_account)})` : "") : "\u274C \u0645\u062A\u0635\u0644 \u0646\u06CC\u0633\u062A"}`, ikb(rows));
}
async function gotToken(c, u, m, text) {
  const { env } = c;
  await del(env, u.id, m.message_id);
  const token = text.replace(/^bot/i, "").trim();
  if (!/^[A-Za-z0-9:_\-]{8,200}$/.test(token)) return void await send(env, u.id, "\u274C \u0642\u0627\u0644\u0628 \u062A\u0648\u06A9\u0646 \u062F\u0631\u0633\u062A \u0646\u06CC\u0633\u062A. \u062F\u0648\u0628\u0627\u0631\u0647 \u0628\u0641\u0631\u0633\u062A\u06CC\u062F (\u06CC\u0627 /cancel).");
  let me;
  try {
    me = await getMe(env, token);
  } catch (e) {
    return void await send(env, u.id, `\u274C \u0627\u06CC\u062A\u0627\u06CC\u0627\u0631 \u062A\u0648\u06A9\u0646 \u0631\u0627 \u0646\u067E\u0630\u06CC\u0631\u0641\u062A: ${esc(e.message)}
\u062F\u0648\u0628\u0627\u0631\u0647 \u0628\u0641\u0631\u0633\u062A\u06CC\u062F (\u06CC\u0627 /cancel).`);
  }
  const account2 = String(me?.username || me?.first_name || me?.name || "").slice(0, 60);
  await env.DB.prepare("UPDATE ea_users SET eitaa_token_enc=?, eitaa_account=? WHERE id=?").bind(await enc(env.SECRET_KEY, token), account2, u.id).run();
  await clearSession(env, u.id);
  await send(env, u.id, "\u2705 \u062A\u0648\u06A9\u0646 \u0627\u06CC\u062A\u0627\u06CC\u0627\u0631 \u062B\u0628\u062A \u0634\u062F \u{1F389}", mainKb(isAdmin(env, u.id)));
}
async function channels(env, uid) {
  const list = await userChannels(env, uid);
  await send(
    env,
    uid,
    list.length ? "<b>\u{1F4E3} \u06A9\u0627\u0646\u0627\u0644\u200C\u0647\u0627\u06CC \u0634\u0645\u0627</b>" : "\u{1F4ED} \u0647\u0646\u0648\u0632 \u06A9\u0627\u0646\u0627\u0644\u06CC \u0627\u0636\u0627\u0641\u0647 \u0646\u06A9\u0631\u062F\u0647\u200C\u0627\u06CC\u062F.",
    ikb([...list.map((ch) => [[`\u{1F7E0} ${ch.title}`.slice(0, 40), `ch:v:${ch.id}`]]), [["\u{1F7E0} \u0627\u0641\u0632\u0648\u062F\u0646 \u06A9\u0627\u0646\u0627\u0644 \u0627\u06CC\u062A\u0627", "ch:add"]]])
  );
}
async function gotChanId(c, u, text) {
  const { env } = c, cid = normalizeChatId(text);
  if (!cid || cid.length < 3 || /\s/.test(cid)) return void await send(env, u.id, "\u0622\u06CC\u062F\u06CC \u06CC\u0627 \u0644\u06CC\u0646\u06A9 \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A. \u062F\u0648\u0628\u0627\u0631\u0647 \u0628\u0641\u0631\u0633\u062A\u06CC\u062F (\u06CC\u0627 /cancel).");
  if ((await userChannels(env, u.id)).some((x) => x.chat_id.toLowerCase() === cid.toLowerCase()))
    return void await send(env, u.id, "\u0627\u06CC\u0646 \u06A9\u0627\u0646\u0627\u0644 \u0642\u0628\u0644\u0627\u064B \u0627\u0636\u0627\u0641\u0647 \u0634\u062F\u0647 \u0627\u0633\u062A.");
  const info = await lookupChat(env, cid);
  if (info.exists === false) return void await send(env, u.id, "\u274C \u0686\u0646\u06CC\u0646 \u06A9\u0627\u0646\u0627\u0644\u06CC \u062F\u0631 \u0627\u06CC\u062A\u0627 \u067E\u06CC\u062F\u0627 \u0646\u0634\u062F. \u0622\u06CC\u062F\u06CC \u0631\u0627 \u0628\u0631\u0631\u0633\u06CC \u06A9\u0646\u06CC\u062F (\u06CC\u0627 /cancel).");
  if (info.title) return saveChannel(c, u, cid, info.title);
  await setSession(env, u.id, "chan_title", { chat_id: cid });
  await send(env, u.id, "\u0646\u0627\u0645 \u0646\u0645\u0627\u06CC\u0634\u06CC \u0628\u0631\u0627\u06CC \u0627\u06CC\u0646 \u06A9\u0627\u0646\u0627\u0644 \u0631\u0627 \u0628\u0641\u0631\u0633\u062A\u06CC\u062F (\u0641\u0642\u0637 \u0628\u0631\u0627\u06CC \u062E\u0648\u062F\u062A\u0627\u0646):");
}
async function gotChanTitle(c, u, d, text) {
  if (!text) return;
  await saveChannel(c, u, String(d.chat_id), text.slice(0, 100));
}
async function saveChannel(c, u, chatId, title) {
  const { env } = c;
  if ((await userChannels(env, u.id)).length >= MAX_CHANNELS) {
    await clearSession(env, u.id);
    return void await send(env, u.id, `\u062D\u062F\u0627\u06A9\u062B\u0631 ${MAX_CHANNELS} \u06A9\u0627\u0646\u0627\u0644 \u0645\u062C\u0627\u0632 \u0627\u0633\u062A.`);
  }
  await env.DB.prepare("INSERT INTO ea_channels(user_id,chat_id,title,platform,created_at) VALUES(?,?,?,?,?)").bind(u.id, chatId, title, "eitaa", now()).run();
  await clearSession(env, u.id);
  await send(env, u.id, `\u2705 \u06A9\u0627\u0646\u0627\u0644 \xAB${esc(title)}\xBB \u0627\u0636\u0627\u0641\u0647 \u0634\u062F.
\u{1F4CC} \u06CC\u0627\u062F\u062A\u0627\u0646 \u0628\u0627\u0634\u062F \u062D\u0633\u0627\u0628 \u0627\u06CC\u062A\u0627\u06CC\u0627\u0631 \u0628\u0627\u06CC\u062F \u062F\u0631 \u0627\u06CC\u0646 \u06A9\u0627\u0646\u0627\u0644 \u0627\u062F\u0645\u06CC\u0646 \u0628\u0627\u0634\u062F.`, mainKb(isAdmin(env, u.id)));
}
async function gotRename(c, u, d, text) {
  if (!text) return;
  await c.env.DB.prepare("UPDATE ea_channels SET title=? WHERE id=? AND user_id=?").bind(text.slice(0, 100), d.channel_id, u.id).run();
  await clearSession(c.env, u.id);
  await send(c.env, u.id, "\u2705 \u0646\u0627\u0645 \u062A\u063A\u06CC\u06CC\u0631 \u06A9\u0631\u062F.", mainKb(isAdmin(c.env, u.id)));
}
async function newPost(c, u) {
  const { env } = c;
  const list = await userChannels(env, u.id);
  if (!list.length) return void await send(env, u.id, u.eitaa_token_enc ? "\u0627\u0628\u062A\u062F\u0627 \u0627\u0632 \xAB\u06A9\u0627\u0646\u0627\u0644\u200C\u0647\u0627\xBB \u06CC\u06A9 \u06A9\u0627\u0646\u0627\u0644 \u0627\u0636\u0627\u0641\u0647 \u06A9\u0646\u06CC\u062F." : "\u0627\u0628\u062A\u062F\u0627 \u0627\u0632 \xAB\u0628\u0631\u0646\u0627\u0645\u0647\u200C\u0647\u0627\u06CC \u0645\u062A\u0635\u0644\xBB \u062A\u0648\u06A9\u0646 \u0627\u06CC\u062A\u0627\u06CC\u0627\u0631 \u0631\u0627 \u0648\u0635\u0644 \u0648 \u0627\u0632 \xAB\u06A9\u0627\u0646\u0627\u0644\u200C\u0647\u0627\xBB \u06CC\u06A9 \u06A9\u0627\u0646\u0627\u0644 \u0627\u0636\u0627\u0641\u0647 \u06A9\u0646\u06CC\u062F.");
  if (list.length === 1) return askContent(env, u.id, list[0]);
  await send(env, u.id, "\u062F\u0631 \u06A9\u062F\u0627\u0645 \u06A9\u0627\u0646\u0627\u0644\u061F", ikb(list.map((ch) => [[`\u{1F7E0} ${ch.title}`.slice(0, 40), `np:c:${ch.id}`]])));
}
async function askContent(env, uid, ch) {
  if (!(await getUser(env, uid))?.eitaa_token_enc) return void await send(env, uid, "\u0627\u0628\u062A\u062F\u0627 \u0627\u0632 \xAB\u0628\u0631\u0646\u0627\u0645\u0647\u200C\u0647\u0627\u06CC \u0645\u062A\u0635\u0644\xBB \u062A\u0648\u06A9\u0646 \u0627\u06CC\u062A\u0627\u06CC\u0627\u0631 \u0631\u0627 \u062B\u0628\u062A \u06A9\u0646\u06CC\u062F.");
  await setSession(env, uid, "np_content", { channel_id: ch.id, silent: 0, pin: 0, view: 0, title: "" });
  await send(env, uid, `\u{1F7E0} \u06A9\u0627\u0646\u0627\u0644: <b>${esc(ch.title)}</b>
\u270D\uFE0F \u0645\u062A\u0646 \u06CC\u0627 \u0641\u0627\u06CC\u0644 (\u0639\u06A9\u0633\u060C \u0648\u06CC\u062F\u06CC\u0648\u060C \u0633\u0646\u062F\u060C \u0635\u062F\u0627\u061B \u062A\u0627 \u06F2\u06F0 \u0645\u06AF\u0627\u0628\u0627\u06CC\u062A) \u0631\u0627 \u0628\u0641\u0631\u0633\u062A\u06CC\u062F. \u0644\u063A\u0648: /cancel`);
}
function extract(m) {
  const cap = (m.caption || "").trim();
  if (m.photo?.length) {
    const p = m.photo[m.photo.length - 1];
    return fileOf(p.file_id, "photo.jpg", p.file_size, cap);
  }
  for (const [key2, def] of [["video", "video.mp4"], ["document", "file"], ["audio", "audio.mp3"], ["voice", "voice.ogg"], ["animation", "animation.mp4"]]) {
    const f = m[key2];
    if (f) return fileOf(f.file_id, f.file_name || def, f.file_size, cap);
  }
  if (m.sticker) return { error: "\u0627\u0633\u062A\u06CC\u06A9\u0631 \u067E\u0634\u062A\u06CC\u0628\u0627\u0646\u06CC \u0646\u0645\u06CC\u200C\u0634\u0648\u062F." };
  if (m.text) return { kind: "text", text: m.text.trim(), file_id: "", file_name: "" };
  return { error: "\u0627\u06CC\u0646 \u0646\u0648\u0639 \u067E\u06CC\u0627\u0645 \u067E\u0634\u062A\u06CC\u0628\u0627\u0646\u06CC \u0646\u0645\u06CC\u200C\u0634\u0648\u062F\u061B \u0645\u062A\u0646 \u06CC\u0627 \u0641\u0627\u06CC\u0644 \u0628\u0641\u0631\u0633\u062A\u06CC\u062F." };
}
var fileOf = (id, name, size, cap) => size && size > MAX_FILE ? { error: "\u062D\u062C\u0645 \u0641\u0627\u06CC\u0644 \u0628\u06CC\u0634 \u0627\u0632 \u06F2\u06F0 \u0645\u06AF\u0627\u0628\u0627\u06CC\u062A \u0627\u0633\u062A (\u0645\u062D\u062F\u0648\u062F\u06CC\u062A \u0631\u0628\u0627\u062A\u200C\u0647\u0627\u06CC \u062A\u0644\u06AF\u0631\u0627\u0645)." } : { kind: "file", text: cap, file_id: id, file_name: name };
async function gotContent(c, u, d, m) {
  const r = extract(m);
  if ("error" in r) return void await send(c.env, u.id, "\u274C " + r.error);
  const data = { ...d, kind: r.kind, text: r.text, file_id: r.file_id, file_name: r.file_name };
  await setSession(c.env, u.id, "np_menu", data);
  await showMenu(c.env, u.id, data);
}
var onoff = (v) => v ? "\u0631\u0648\u0634\u0646" : "\u062E\u0627\u0645\u0648\u0634";
async function showMenu(env, uid, d, mid) {
  const ch = await getChannel(env, d.channel_id);
  const preview = d.kind === "file" ? `\u{1F4CE} ${esc(d.file_name)}${d.text ? "\n" + esc(d.text.slice(0, 300)) : ""}` : esc(String(d.text).slice(0, 400));
  const t = `<b>\u{1F440} \u067E\u06CC\u0634\u200C\u0646\u0645\u0627\u06CC\u0634</b> (\u{1F7E0} ${esc(ch?.title || "?")})

${preview}${d.title ? `

\u{1F3F7} \u0639\u0646\u0648\u0627\u0646: ${esc(d.title)}` : ""}`;
  const rows = [
    [["\u{1F680} \u0627\u0631\u0633\u0627\u0644 \u0627\u0644\u0627\u0646", "np:now"], ["\u23F0 \u0632\u0645\u0627\u0646\u200C\u0628\u0646\u062F\u06CC", "np:sch"]],
    [[`\u{1F515} \u0628\u06CC\u200C\u0635\u062F\u0627: ${onoff(d.silent)}`, "np:silent"], [`\u{1F4CC} \u067E\u06CC\u0646: ${onoff(d.pin)}`, "np:pin"]],
    [["\u{1F3F7} \u0639\u0646\u0648\u0627\u0646", "np:title"], [`\u{1F441} \u062D\u0630\u0641 \u067E\u0633 \u0627\u0632 \u0628\u0627\u0632\u062F\u06CC\u062F: ${d.view || "\u062E\u0627\u0645\u0648\u0634"}`, "np:view"]]
  ];
  rows.push([["\u274C \u0644\u063A\u0648", "np:x"]]);
  if (mid) await edit(env, uid, mid, t, ikb(rows));
  else await send(env, uid, t, ikb(rows));
}
async function gotNpField(c, u, d, field, text) {
  if (field === "view") {
    const n = parseInt(text.replace(/[۰-۹]/g, (x) => String(x.charCodeAt(0) - 1776)), 10);
    if (isNaN(n) || n < 0 || n > 1e6) return void await send(c.env, u.id, "\u06CC\u06A9 \u0639\u062F\u062F \u0628\u0641\u0631\u0633\u062A\u06CC\u062F (\u06F0 = \u062E\u0627\u0645\u0648\u0634).");
    d.view = n;
  } else d.title = text.slice(0, 100);
  await setSession(c.env, u.id, "np_menu", d);
  await showMenu(c.env, u.id, d);
}
async function createPost(env, uid, d, runAt) {
  const r = await env.DB.prepare("INSERT INTO ea_posts(user_id,channel_id,kind,text,file_id,file_name,title,silent,pin,view_delete,run_at,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending',?)").bind(uid, d.channel_id, d.kind, d.text || "", d.file_id || "", d.file_name || "", d.title || "", d.silent ? 1 : 0, d.pin ? 1 : 0, d.view || 0, runAt, now()).run();
  return r.meta.last_row_id;
}
async function gotWhen(c, u, d, text) {
  const at = parseWhen(text);
  if (at === null) return void await send(c.env, u.id, "\u274C \u0632\u0645\u0627\u0646 \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u06CC\u0627 \u06AF\u0630\u0634\u062A\u0647 \u0627\u0633\u062A. \u0646\u0645\u0648\u0646\u0647: <code>\u0641\u0631\u062F\u0627 09:00</code> \u06CC\u0627 <code>+45</code>");
  const id = await createPost(c.env, u.id, d, at);
  await clearSession(c.env, u.id);
  await send(c.env, u.id, `\u2705 \u067E\u0633\u062A #${id} \u0628\u0631\u0627\u06CC ${fmtDt(at)} (\u0648\u0642\u062A \u062A\u0647\u0631\u0627\u0646) \u0632\u0645\u0627\u0646\u200C\u0628\u0646\u062F\u06CC \u0634\u062F.`, mainKb(isAdmin(c.env, u.id)));
}
async function scheduled(env, uid) {
  const rows = (await env.DB.prepare("SELECT * FROM ea_posts WHERE user_id=? AND status='pending' ORDER BY run_at LIMIT 10").bind(uid).all()).results;
  if (!rows.length) return void await send(env, uid, "\u067E\u0633\u062A \u0632\u0645\u0627\u0646\u200C\u0628\u0646\u062F\u06CC\u200C\u0634\u062F\u0647\u200C\u0627\u06CC \u0646\u062F\u0627\u0631\u06CC\u062F.");
  for (const p of rows) {
    const preview = p.kind === "file" ? `\u{1F4CE} ${p.file_name}` : p.text.slice(0, 80);
    await send(env, uid, `\u23F0 #${p.id} \xB7 ${fmtDt(p.run_at)}
${esc(preview)}`, ikb([[["\u{1F5D1} \u0644\u063A\u0648", `sp:del:${p.id}`]]]));
  }
}
async function account(env, u, admin) {
  const n = (await userChannels(env, u.id)).length;
  await send(env, u.id, `<b>\u{1F464} \u062D\u0633\u0627\u0628 \u0645\u0646</b>

\u{1F194} \u0634\u0646\u0627\u0633\u0647: <code>${u.id}</code>
\u{1F48E} \u0627\u0634\u062A\u0631\u0627\u06A9: ${admin ? "\u0645\u062F\u06CC\u0631" : u.expires_at && u.expires_at > now() ? "\u062A\u0627 " + fmtDt(u.expires_at) : "\u063A\u06CC\u0631\u0641\u0639\u0627\u0644"}
\u{1F7E0} \u062A\u0648\u06A9\u0646 \u0627\u06CC\u062A\u0627\u06CC\u0627\u0631: ${u.eitaa_token_enc ? "\u2705" : "\u274C"}
\u{1F4E3} \u06A9\u0627\u0646\u0627\u0644\u200C\u0647\u0627: ${n}`);
}
async function adminPanel(env, uid) {
  const chain = await llmChain(env);
  await send(env, uid, await adminCmd(env, "/stats", []) + `

\u{1F9E0} \u0647\u0648\u0634 \u0645\u0635\u0646\u0648\u0639\u06CC \u0627\u06CC\u062C\u0646\u062A: ${chain.length ? "\u2705 " + chain.map((x) => x.name).join(" \u2190 ") : "\u274C \u0628\u0627\u06CC\u0646\u062F\u06CC\u0646\u06AF AI \u062F\u0631 wrangler.jsonc \u0641\u0639\u0627\u0644 \u0646\u06CC\u0633\u062A"}

<code>/grant ID DAYS</code> \xB7 <code>/ban ID</code> \xB7 <code>/unban ID</code> \xB7 <code>/stats</code> \xB7 <code>/src \u0646\u0627\u0645_\u06A9\u0627\u0646\u0627\u0644</code>`);
}
async function adminCmd(env, cmd, a) {
  const id = parseInt(a[0] || "", 10);
  switch (cmd) {
    case "/stats": {
      const g = async (q) => (await env.DB.prepare(q).first()).n;
      return `\u{1F4CA} \u06A9\u0627\u0631\u0628\u0631\u0627\u0646: ${await g("SELECT COUNT(*) n FROM ea_users")} \xB7 \u0641\u0639\u0627\u0644: ${await g(`SELECT COUNT(*) n FROM ea_users WHERE expires_at>${now()}`)}
\u067E\u0633\u062A\u200C\u0647\u0627 \u2014 \u062F\u0631 \u0627\u0646\u062A\u0638\u0627\u0631: ${await g("SELECT COUNT(*) n FROM ea_posts WHERE status='pending'")} \xB7 \u0627\u0631\u0633\u0627\u0644\u200C\u0634\u062F\u0647: ${await g("SELECT COUNT(*) n FROM ea_posts WHERE status='sent'")} \xB7 \u0646\u0627\u0645\u0648\u0641\u0642: ${await g("SELECT COUNT(*) n FROM ea_posts WHERE status='failed'")}`;
    }
    case "/grant": {
      const days = parseInt(a[1] || "", 10);
      if (!id || !days || days < 1 || days > 3650) return "\u0627\u0633\u062A\u0641\u0627\u062F\u0647: /grant ID DAYS";
      const u = await getUser(env, id);
      if (!u) return "\u0627\u06CC\u0646 \u06A9\u0627\u0631\u0628\u0631 \u0647\u0646\u0648\u0632 \u0631\u0628\u0627\u062A \u0631\u0627 \u0628\u0627\u0632 \u0646\u06A9\u0631\u062F\u0647 \u0627\u0633\u062A.";
      const base = u.expires_at && u.expires_at > now() ? u.expires_at : now();
      const until = base + days * 86400;
      await env.DB.prepare("UPDATE ea_users SET expires_at=? WHERE id=?").bind(until, id).run();
      await send(env, id, `\u2705 \u0627\u0634\u062A\u0631\u0627\u06A9 \u0634\u0645\u0627 \u062A\u0627 ${fmtDt(until)} \u0641\u0639\u0627\u0644 \u0634\u062F.`);
      return `\u2705 ${id} \u062A\u0627 ${fmtDt(until)} \u0641\u0639\u0627\u0644 \u0634\u062F.`;
    }
    case "/src": {
      const name = normalizeChatId(a[0] || "");
      if (!name) return "\u0627\u0633\u062A\u0641\u0627\u062F\u0647: /src channelname";
      const r = await fetchChannel(env, name);
      const m = r.messages[r.messages.length - 1];
      return `\u{1F52C} ${esc(name)} \u2014 HTTP ${r.status} \u2014 \u067E\u06CC\u0627\u0645\u200C\u0647\u0627\u06CC \u0634\u0646\u0627\u0633\u0627\u06CC\u06CC\u200C\u0634\u062F\u0647: ${r.messages.length} (\u0639\u06A9\u0633: ${r.messages.filter((x) => x.image && !x.sticker).length}\u060C \u0627\u0633\u062A\u06CC\u06A9\u0631: ${r.messages.filter((x) => x.sticker).length})${r.title ? `
\u0639\u0646\u0648\u0627\u0646: ${esc(r.title)}` : ""}${r.note ? `
\u26A0\uFE0F ${esc(r.note)}` : ""}` + (m ? `

\u0622\u062E\u0631\u06CC\u0646 \u067E\u06CC\u0627\u0645 (#${m.id}${m.image ? " \u{1F5BC}" : ""}):
${esc(cleanText(m.text, name, r.title).slice(0, 500))}` : `

\u0646\u0645\u0648\u0646\u0647\u200C\u06CC \u0645\u062A\u0646 \u0635\u0641\u062D\u0647:
${esc(r.snippet)}`);
    }
    case "/ban":
    case "/unban": {
      if (!id) return `\u0627\u0633\u062A\u0641\u0627\u062F\u0647: ${cmd} ID`;
      await env.DB.prepare("UPDATE ea_users SET banned=? WHERE id=?").bind(cmd === "/ban" ? 1 : 0, id).run();
      return cmd === "/ban" ? `\u26D4\uFE0F ${id} \u0645\u0633\u062F\u0648\u062F \u0634\u062F.` : `\u2705 ${id} \u0622\u0632\u0627\u062F \u0634\u062F.`;
    }
  }
  return "";
}
async function onCallback2(c, q) {
  const { env } = c, uid = q.from.id, admin = isAdmin(env, uid), mid = q.message?.message_id;
  const user = await touchUser(env, uid, q.from.first_name || "", q.from.username || "");
  if (user.banned && !admin || !hasAccess(user, admin, env)) return answer(env, q.id, "\u062F\u0633\u062A\u0631\u0633\u06CC \u0646\u062F\u0627\u0631\u06CC\u062F.", true);
  const [kind, act, arg] = (q.data || "").split(":");
  const s = await getSession(env, uid);
  if (kind === "tk") {
    await answer(env, q.id);
    if (act === "set") {
      await setSession(env, uid, "token", {});
      return void await send(env, uid, "\u{1F511} \u062A\u0648\u06A9\u0646 \u0627\u06CC\u062A\u0627\u06CC\u0627\u0631 \u0631\u0627 \u0628\u0641\u0631\u0633\u062A\u06CC\u062F\n\u{1F9F9} \u067E\u06CC\u0627\u0645 \u0634\u0645\u0627 \u0628\u0639\u062F \u0627\u0632 \u062E\u0648\u0627\u0646\u062F\u0646 \u067E\u0627\u06A9 \u0645\u06CC\u200C\u0634\u0648\u062F. \u0644\u063A\u0648: /cancel");
    }
    if (act === "del") {
      await env.DB.prepare("UPDATE ea_users SET eitaa_token_enc='', eitaa_account='' WHERE id=?").bind(uid).run();
      return void await send(env, uid, "\u{1F5D1} \u062A\u0648\u06A9\u0646 \u062D\u0630\u0641 \u0634\u062F.");
    }
  }
  if (kind === "ag") return onCallback(c, user, admin, q, act, arg, s);
  if (kind === "ch") {
    await answer(env, q.id);
    if (act === "add") {
      await setSession(env, uid, "chan_id", {});
      return void await send(env, uid, "\u0622\u06CC\u062F\u06CC \u06CC\u0627 \u0644\u06CC\u0646\u06A9 \u06A9\u0627\u0646\u0627\u0644 \u0627\u06CC\u062A\u0627 \u0631\u0627 \u0628\u0641\u0631\u0633\u062A\u06CC\u062F. \u0645\u062B\u0627\u0644: <code>@mychannel</code> \u06CC\u0627 <code>https://eitaa.com/mychannel</code>");
    }
    const ch = await getChannel(env, Number(arg));
    if (!ch || ch.user_id !== uid) return;
    if (act === "v") return void await send(env, uid, `<b>${esc(ch.title)}</b>
<code>${esc(ch.chat_id)}</code>`, ikb([[["\u270F\uFE0F \u062A\u063A\u06CC\u06CC\u0631 \u0646\u0627\u0645", `ch:rn:${ch.id}`], ["\u{1F5D1} \u062D\u0630\u0641", `ch:del:${ch.id}`]]]));
    if (act === "rn") {
      await setSession(env, uid, "chan_rename", { channel_id: ch.id });
      return void await send(env, uid, "\u0646\u0627\u0645 \u062C\u062F\u06CC\u062F \u0631\u0627 \u0628\u0641\u0631\u0633\u062A\u06CC\u062F:");
    }
    if (act === "del") return void await send(env, uid, `\xAB${esc(ch.title)}\xBB \u062D\u0630\u0641 \u0634\u0648\u062F\u061F (\u067E\u0633\u062A\u200C\u0647\u0627\u06CC \u0632\u0645\u0627\u0646\u200C\u0628\u0646\u062F\u06CC\u200C\u0634\u062F\u0647 \u0648 \u0627\u06CC\u062C\u0646\u062A\u200C\u0647\u0627\u06CC \u0622\u0646 \u0647\u0645 \u062D\u0630\u0641 \u0645\u06CC\u200C\u0634\u0648\u0646\u062F)`, ikb([[["\u2705 \u0628\u0644\u0647\u060C \u062D\u0630\u0641", `ch:dy:${ch.id}`], ["\u062E\u06CC\u0631", "ch:no:0"]]]));
    if (act === "dy") {
      await env.DB.batch([env.DB.prepare("UPDATE ea_posts SET status='canceled' WHERE channel_id=? AND status IN ('pending','draft')").bind(ch.id), env.DB.prepare("DELETE FROM agent_jobs WHERE channel_id=?").bind(ch.id), env.DB.prepare("DELETE FROM ea_channels WHERE id=?").bind(ch.id)]);
      return void await send(env, uid, "\u{1F5D1} \u062D\u0630\u0641 \u0634\u062F.");
    }
    return;
  }
  if (kind === "sp" && act === "del") {
    const r = await env.DB.prepare("UPDATE ea_posts SET status='canceled' WHERE id=? AND user_id=? AND status='pending'").bind(Number(arg), uid).run();
    await answer(env, q.id, r.meta.changes ? "\u0644\u063A\u0648 \u0634\u062F." : "\u0642\u0627\u0628\u0644 \u0644\u063A\u0648 \u0646\u06CC\u0633\u062A.");
    if (mid && r.meta.changes) await edit(env, uid, mid, `\u{1F5D1} \u067E\u0633\u062A #${arg} \u0644\u063A\u0648 \u0634\u062F.`);
    return;
  }
  if (kind === "np") {
    if (act === "c") {
      await answer(env, q.id);
      const ch = await getChannel(env, Number(arg));
      return ch && ch.user_id === uid ? askContent(env, uid, ch) : void 0;
    }
    if (act === "x") {
      await clearSession(env, uid);
      await answer(env, q.id, "\u0644\u063A\u0648 \u0634\u062F.");
      return void (mid && await edit(env, uid, mid, "\u0644\u063A\u0648 \u0634\u062F."));
    }
    if (s.state !== "np_menu" && s.state !== "np_when") return answer(env, q.id, "\u0627\u06CC\u0646 \u067E\u06CC\u0634\u200C\u0646\u0648\u06CC\u0633 \u0645\u0646\u0642\u0636\u06CC \u0634\u062F\u0647\u061B \u062F\u0648\u0628\u0627\u0631\u0647 \xAB\u067E\u0633\u062A \u062C\u062F\u06CC\u062F\xBB \u0628\u0632\u0646\u06CC\u062F.", true);
    const d = s.data;
    if (act === "silent" || act === "pin") {
      d[act] = d[act] ? 0 : 1;
      await setSession(env, uid, "np_menu", d);
      await answer(env, q.id);
      return mid ? showMenu(env, uid, d, mid) : void 0;
    }
    if (act === "title") {
      await answer(env, q.id);
      await setSession(env, uid, "np_title", d);
      return void await send(env, uid, "\u0639\u0646\u0648\u0627\u0646 \u067E\u0633\u062A \u0631\u0627 \u0628\u0641\u0631\u0633\u062A\u06CC\u062F:");
    }
    if (act === "view") {
      await answer(env, q.id);
      await setSession(env, uid, "np_view", d);
      return void await send(env, uid, "\u067E\u0633 \u0627\u0632 \u0686\u0646\u062F \u0628\u0627\u0632\u062F\u06CC\u062F \u067E\u0633\u062A \u062D\u0630\u0641 \u0634\u0648\u062F\u061F \u0639\u062F\u062F \u0628\u0641\u0631\u0633\u062A\u06CC\u062F (\u06F0 = \u062E\u0627\u0645\u0648\u0634):");
    }
    if (act === "sch") {
      await answer(env, q.id);
      await setSession(env, uid, "np_when", d);
      return void await send(env, uid, "\u23F0 \u0632\u0645\u0627\u0646 \u0627\u0646\u062A\u0634\u0627\u0631 (\u0648\u0642\u062A \u062A\u0647\u0631\u0627\u0646):\n<code>18:30</code> \xB7 <code>\u0641\u0631\u062F\u0627 09:00</code> \xB7 <code>+45</code> \xB7 <code>1405/07/20 18:30</code>\n\u0644\u063A\u0648: /cancel");
    }
    if (act === "now") {
      const id = await createPost(env, uid, d, now());
      await clearSession(env, uid);
      await answer(env, q.id, "\u062F\u0631 \u062D\u0627\u0644 \u0627\u0631\u0633\u0627\u0644\u2026");
      if (d.kind === "file") {
        if (mid) await edit(env, uid, mid, `\u{1F680} \u067E\u0633\u062A #${id} \u062F\u0631 \u0635\u0641 \u0627\u0631\u0633\u0627\u0644 \u0642\u0631\u0627\u0631 \u06AF\u0631\u0641\u062A (\u062D\u062F\u0627\u06A9\u062B\u0631 \u062A\u0627 \u06CC\u06A9 \u062F\u0642\u06CC\u0642\u0647\u200C\u06CC \u062F\u06CC\u06AF\u0631 \u0627\u0631\u0633\u0627\u0644 \u0645\u06CC\u200C\u0634\u0648\u062F)\u2026`);
      } else {
        if (mid) await edit(env, uid, mid, `\u{1F680} \u067E\u0633\u062A #${id} \u062F\u0631 \u062D\u0627\u0644 \u0627\u0631\u0633\u0627\u0644\u2026`);
        c.wait(deliver(env, id));
      }
    }
  }
}

// eitaa-src/schema.ts
var SCHEMA = [
  "CREATE TABLE IF NOT EXISTS ea_users (\n  id INTEGER PRIMARY KEY,\n  name TEXT NOT NULL DEFAULT '',\n  username TEXT NOT NULL DEFAULT '',\n  eitaa_token_enc TEXT NOT NULL DEFAULT '',\n  eitaa_account TEXT NOT NULL DEFAULT '',\n  expires_at INTEGER,\n  banned INTEGER NOT NULL DEFAULT 0,\n  created_at INTEGER NOT NULL\n)",
  "CREATE TABLE IF NOT EXISTS ea_channels (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  user_id INTEGER NOT NULL,\n  chat_id TEXT NOT NULL,\n  title TEXT NOT NULL,\n  platform TEXT NOT NULL DEFAULT 'eitaa',\n  created_at INTEGER NOT NULL\n)",
  "CREATE INDEX IF NOT EXISTS idx_channels_user ON ea_channels(user_id)",
  "CREATE TABLE IF NOT EXISTS ea_posts (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  user_id INTEGER NOT NULL,\n  channel_id INTEGER NOT NULL,\n  kind TEXT NOT NULL,\n  text TEXT NOT NULL DEFAULT '',\n  file_id TEXT NOT NULL DEFAULT '',\n  file_name TEXT NOT NULL DEFAULT '',\n  title TEXT NOT NULL DEFAULT '',\n  silent INTEGER NOT NULL DEFAULT 0,\n  pin INTEGER NOT NULL DEFAULT 0,\n  view_delete INTEGER NOT NULL DEFAULT 0,\n  run_at INTEGER NOT NULL,\n  status TEXT NOT NULL DEFAULT 'pending',\n  error TEXT NOT NULL DEFAULT '',\n  eitaa_message_id TEXT NOT NULL DEFAULT '',\n  claimed_at INTEGER,\n  created_at INTEGER NOT NULL,\n  sent_at INTEGER,\n  src_url TEXT NOT NULL DEFAULT '',\n  job_id INTEGER\n)",
  "CREATE INDEX IF NOT EXISTS idx_posts_due ON ea_posts(status, run_at)",
  "CREATE INDEX IF NOT EXISTS idx_posts_user ON ea_posts(user_id, status)",
  "CREATE TABLE IF NOT EXISTS ea_sessions (\n  user_id INTEGER PRIMARY KEY,\n  state TEXT NOT NULL DEFAULT '',\n  data TEXT NOT NULL DEFAULT '{}',\n  updated_at INTEGER NOT NULL\n)",
  "CREATE TABLE IF NOT EXISTS agent_jobs (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  user_id INTEGER NOT NULL,\n  channel_id INTEGER NOT NULL,            \n  name TEXT NOT NULL DEFAULT '',\n  instruction TEXT NOT NULL,              \n  times TEXT NOT NULL DEFAULT '[]',       \n  days TEXT,                              \n  once_at INTEGER,                        \n  footer TEXT NOT NULL DEFAULT '',        \n  approve INTEGER NOT NULL DEFAULT 0,     \n  enabled INTEGER NOT NULL DEFAULT 1,\n  run_now INTEGER NOT NULL DEFAULT 0,     \n  last_key TEXT NOT NULL DEFAULT '',      \n  retry_at INTEGER,                       \n  attempts INTEGER NOT NULL DEFAULT 0,\n  last_info TEXT NOT NULL DEFAULT '',\n  created_at INTEGER NOT NULL\n)",
  "CREATE INDEX IF NOT EXISTS idx_agent_user ON agent_jobs(user_id)",
  "CREATE TABLE IF NOT EXISTS agent_seen (\n  job_id INTEGER NOT NULL,\n  k TEXT NOT NULL,                        \n  seen_at INTEGER NOT NULL,\n  PRIMARY KEY (job_id, k)\n)"
];

// eitaa-src/entry.ts
function adapt(host, access) {
  return {
    ...host,
    BOT_TOKEN: host.TELEGRAM_TOKEN,
    SECRET_KEY: host.EITAA_SECRET_KEY || `ea:${host.WEBHOOK_SECRET || host.TELEGRAM_TOKEN}`,
    WEBHOOK_SECRET: host.WEBHOOK_SECRET || "",
    ADMIN_IDS: String(host.OWNER_ID || ""),
    EA_ACCESS: access,
    EA_MODEL: host.MODEL || "@cf/google/gemma-4-26b-a4b-it"
  };
}
async function ensureSchema(host) {
  await host.DB.batch(SCHEMA.map((s) => host.DB.prepare(s)));
}
async function handle(host, access, update, wait) {
  await handleUpdate({ env: adapt(host, access), wait }, update);
}
async function cron(host) {
  await tick(adapt(host, true));
}
export {
  SCHEMA,
  adapt,
  cron,
  ensureSchema,
  handle
};
