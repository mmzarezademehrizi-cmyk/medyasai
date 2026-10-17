// The agent: the owner describes a task in plain Persian ("every morning at 7 post the good-morning message of @x with today's date",
// "twice a day bring 2 posts about sport from these public channels and sign them with my id"). An LLM carries it out with a few tools:
// read a public Eitaa channel, ask the date, publish to the owner's channel, retry later. Code (not the model) owns the schedule,
// the owner's signature, duplicate protection and delivery.
import { JobRow, getChannel, now } from "./db";
import { Env } from "./env";
import { ChatMsg, ToolDef, chatJson, chatTools } from "./llm";
import { llmReady } from "./providers";
import { cleanText, fetchChannel, norm } from "./source";
import * as tg from "./tg";
import { Btn, ikb } from "./tg";
import { WEEKDAYS, atTime, esc, fmtDt, fromLocal, jalaliLong, mentionsDay, mentionsOtherDate, normDigits, normalizeChatId, pad2, slotKey, toLocal } from "./util";

const MAX_STEPS = 9;
const MAX_CHANNELS_PER_RUN = 5;
const MAX_POSTS_PER_RUN = 8;
const RETRY_WINDOW_S = 120 * 60;   // a slot may be retried (e.g. "the good-morning post is not there yet") for up to 2 hours
const STALE_S = 3 * 3600;          // a slot that was never started and is older than this is skipped (worker was down)
const RUN_BUDGET_MS = 100_000;

// ------------------------------------------------------------------ schedule helpers
export interface Plan { name: string; times: string[]; days: number[] | null; onceAt: number | null; summary: string }

export const parseJson = <T>(s: string | null | undefined, d: T): T => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

/** "07:00 20:30" / "۷:۰۰" -> sorted unique HH:MM list; "الان" -> "now"; otherwise null. */
export function parseTimes(text: string): string[] | "now" | null {
  const t = normDigits(text).replace(/،/g, " ");
  if (/(^|\s)(الان|همین ?الان|now)(\s|$)/i.test(t)) return "now";
  const out = new Set<string>();
  for (const m of t.matchAll(/(?<!\d)(\d{1,2})[:٫.](\d{2})(?!\d)/g)) {
    const h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    out.add(`${pad2(h)}:${pad2(mi)}`);
  }
  return out.size && out.size <= 8 ? [...out].sort() : null;
}

export function describeSchedule(j: { times: string; days: string | null; once_at: number | null }): string {
  if (j.once_at) return `یک‌بار، ${fmtDt(j.once_at)}`;
  const times = parseJson<string[]>(j.times, []), days = parseJson<number[] | null>(j.days, null);
  if (!times.length) return "فقط با دکمه‌ی «اجرا الان»";
  const d = days && days.length && days.length < 7 ? days.map((x) => WEEKDAYS[x]).join("، ") : "هر روز";
  return `${d}، ساعت ${times.join(" و ")} (وقت تهران)`;
}

/** Turns the owner's sentence into a schedule + short name + a one-line summary of what the agent will do. */
export async function planJob(env: Env, instruction: string): Promise<Plan | null> {
  const t = now(), l = toLocal(t);
  let r: any;
  try { r = await planWithModel(env, instruction, t, l); }
  catch {   // models unavailable: read the schedule with plain rules
    const tm = parseTimes(instruction);
    return { name: instruction.replace(/@\S+/g, "").trim().slice(0, 30) || "ایجنت", times: Array.isArray(tm) ? tm : [], days: null, onceAt: null,
      summary: "برنامه با قوانین ساده خوانده شد: " + (Array.isArray(tm) ? `ساعت ${tm.join(" و ")} هر روز.` : "بدون زمان مشخص (فقط «اجرا الان»).") };
  }
  if (!r) return null;
  return planFrom(r, t);
}
const planWithModel = (env: Env, instruction: string, t: number, l: ReturnType<typeof toLocal>) => chatJson(env,
    "You read a Persian task description for a channel-content agent and extract its schedule. Reply with a JSON object only: " +
    '{"name": short Persian title (max 30 chars), "times": array of "HH:MM" 24h Tehran times the task runs each day (empty array if no time is stated), ' +
    '"days": null if every day, otherwise array of weekday numbers 0=Sunday,1=Monday,...,6=Saturday (Saturday=شنبه, Friday=جمعه), ' +
    '"once": null, or "YYYY-MM-DD HH:MM" (Gregorian, Tehran time) if the task is a ONE-TIME task (e.g. "tomorrow at 9", "today 18:00"), ' +
    '"summary": one Persian sentence saying exactly what the agent will do}. ' +
    `Now in Tehran: ${l.y}-${pad2(l.mo)}-${pad2(l.d)} ${pad2(l.h)}:${pad2(l.mi)} (${jalaliLong(t)}).`,
    instruction, 600);
function planFrom(r: any, t: number): Plan {
  const times = Array.isArray(r.times) ? (parseTimes((r.times as unknown[]).join(" ")) as string[] | "now" | null) : null;
  const days = Array.isArray(r.days) ? (r.days as unknown[]).map(Number).filter((x) => x >= 0 && x <= 6) : null;
  let onceAt: number | null = null;
  const om = typeof r.once === "string" ? r.once.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/) : null;
  if (om) { onceAt = fromLocal({ y: +om[1], mo: +om[2], d: +om[3], h: +om[4], mi: +om[5] }); if (onceAt < t + 30) onceAt = t + 60; }
  return {
    name: String(r.name || "ایجنت").slice(0, 40),
    times: onceAt || !Array.isArray(times) ? [] : times, days: days && days.length ? days : null, onceAt,
    summary: String(r.summary || "").slice(0, 400),
  };
}

// ------------------------------------------------------------------ tick (called every minute from the cron)
interface Slot { key: string; epoch: number; kind: "daily" | "once" | "manual" }

function dueSlot(j: JobRow, t: number): Slot | null {
  if (j.run_now) return { key: `manual-${t}`, epoch: t, kind: "manual" };
  if (j.once_at) return !j.last_key && j.once_at <= t ? { key: "once", epoch: j.once_at, kind: "once" } : null;
  const times = parseJson<string[]>(j.times, []), days = parseJson<number[] | null>(j.days, null);
  const l = toLocal(t);
  if (days && days.length && !days.includes(new Date(Date.UTC(l.y, l.mo - 1, l.d)).getUTCDay())) return null;
  for (const hhmm of times) {
    const epoch = atTime(t, hhmm), key = slotKey(epoch);
    if (epoch <= t && key > j.last_key) return { key, epoch, kind: "daily" };
  }
  return null;
}

export async function agentTick(env: Env): Promise<void> {
  if (!(await llmReady(env))) return;
  const t = now();
  const jobs = (await env.DB.prepare("SELECT * FROM agent_jobs WHERE enabled=1 AND (retry_at IS NULL OR retry_at<=?) ORDER BY id LIMIT 200").bind(t).all<JobRow>()).results;
  let ran = 0;
  for (const j of jobs) {
    const slot = dueSlot(j, t);
    if (!slot) continue;
    // a daily slot that was never started and is long past (worker was down) is skipped instead of firing at a strange hour
    if (slot.kind === "daily" && j.attempts === 0 && t - slot.epoch > STALE_S) {
      await env.DB.prepare("UPDATE agent_jobs SET last_key=? WHERE id=?").bind(slot.key, j.id).run();
      continue;
    }
    if (ran >= 2) break;   // keep each invocation within free-plan limits; the rest wait for the next minute
    ran++;
    try { await runJob(env, j, slot, t); } catch (e) { console.error("agent job failed", j.id, (e as Error).message); }
  }
}

async function runJob(env: Env, j: JobRow, slot: Slot, t: number): Promise<void> {
  const claim = await env.DB.prepare("UPDATE agent_jobs SET retry_at=?, attempts=attempts+1, run_now=0 WHERE id=? AND (retry_at IS NULL OR retry_at<=?) AND attempts=?")
    .bind(t + 300, j.id, t, j.attempts).run();
  if (!claim.meta.changes) return;
  const final = slot.kind === "manual" || j.attempts + 1 >= 3 || t - slot.epoch > RETRY_WINDOW_S;
  let res: RunResult;
  try { res = await runAgent(env, j, slot, final); }
  catch (e) { res = { summary: (e as Error).message, posts: 0, retryMin: null, error: true }; }
  const retry = !final && res.retryMin ? Math.min(Math.max(res.retryMin, 2), 30) : 0;
  const info = `${fmtDt(now())} — ${res.posts} پست — ${res.summary}`.slice(0, 500);
  if (retry) {
    await env.DB.prepare("UPDATE agent_jobs SET retry_at=?, last_info=? WHERE id=?").bind(now() + retry * 60, info, j.id).run();
  } else {
    await env.DB.prepare(`UPDATE agent_jobs SET ${slot.kind === "manual" ? "" : "last_key=?, "}retry_at=NULL, attempts=0, last_info=?${slot.kind === "once" ? ", enabled=0" : ""} WHERE id=?`)
      .bind(...(slot.kind === "manual" ? [info, j.id] : [slot.key, info, j.id])).run();
  }
  if (!retry && (res.posts === 0 || res.error || slot.kind === "manual"))
    await tg.send(env, j.user_id, `🤖 <b>${esc(j.name || "ایجنت")}</b>\n${res.error ? "❌ " : ""}${esc(res.summary)}${res.posts ? `\n📝 ${res.posts} پست ساخته شد.` : ""}`);
  if (retry) console.log("agent retry", j.id, retry);
}

// ------------------------------------------------------------------ shared tool: read a public channel
// Token economy: the model only sees fresh, unused, recent posts with a short preview. To forward a post it passes `from_ref`
// and the CODE copies the full cleaned text — so long posts are never sent to the model twice nor written back token by token.
export interface RefInfo { image: string; text: string; sticker: boolean }
export interface ReadState { channels: Map<string, Awaited<ReturnType<typeof fetchChannel>>>; refs: Map<string, RefInfo> }
const PREVIEW = 260, PREVIEW_FULL = 1000, MAX_POSTS_SHOWN = 8, MAX_AGE_S = 3 * 86400;

/** The read_channel tool, used by both the scheduled agent and the live chat. `jobId` (if any) hides posts already used by that job. */
export async function readChannel(env: Env, st: ReadState, a: any, jobId: number | null, maxChannels: number): Promise<unknown> {
  const cid = normalizeChatId(String(a.channel || "")).replace(/^@/, "");
  if (!/^[A-Za-z0-9_.]{3,64}$/.test(cid) || /^\d+$/.test(cid)) return { error: "invalid channel username" };
  if (!st.channels.has(cid) && st.channels.size >= maxChannels) return { error: `at most ${maxChannels} channels per run` };
  let r = st.channels.get(cid);
  if (!r) { r = await fetchChannel(env, cid); st.channels.set(cid, r); }
  if (!r.ok) return { error: r.note || "could not read channel (is it public?)" };
  const limit = Math.min(Math.max(parseInt(a.limit, 10) || MAX_POSTS_SHOWN, 1), 20), cut = a.full ? PREVIEW_FULL : PREVIEW, t = now();
  const seen = jobId === null ? new Set<string>() : new Set((await env.DB.prepare("SELECT k FROM agent_seen WHERE job_id=?").bind(jobId).all<{ k: string }>()).results.map((x) => x.k));
  let hidden = 0;
  const posts: unknown[] = [];
  for (const m of r.messages.slice().reverse()) {                       // newest first
    const ref = `${cid}/${m.id}`;
    if (seen.has(ref) || (m.ts !== null && t - m.ts > MAX_AGE_S)) { hidden++; continue; }
    const text = cleanText(m.text, cid, r.title);
    st.refs.set(ref, { image: m.image, text, sticker: m.sticker });
    if (posts.length >= limit) continue;
    const d = m.ts ? toLocal(m.ts) : null;
    posts.push({ ref, ...(d ? { date: `${d.y}-${pad2(d.mo)}-${pad2(d.d)} ${pad2(d.h)}:${pad2(d.mi)}` } : {}), text: text.slice(0, cut) + (text.length > cut ? "…" : ""), ...(m.image && !m.sticker ? { image: 1 } : {}), ...(m.sticker ? { sticker: 1 } : {}) });
  }
  return { channel: cid, posts, ...(hidden ? { hidden_old_or_used: hidden } : {}) };
}

/** Text/sticker/image of a post the model refers to, as the code should publish it. */
export function resolvePost(st: ReadState, a: any, footer: string): { text: string; image: string; sticker: boolean; refs: string[] } | { error: string } {
  let text = String(a.text || "").trim();
  const fromRef = a.from_ref ? String(a.from_ref) : "", imageRef = a.image_ref ? String(a.image_ref) : "";
  if (fromRef && !text) { const r = st.refs.get(fromRef); if (!r) return { error: "unknown from_ref (use a ref from read_channel)" }; text = r.text; }
  const ri = imageRef ? st.refs.get(imageRef) : undefined;
  if (imageRef && !ri?.image) return { error: "image_ref has no image/sticker" };
  const sticker = !!ri?.sticker;
  if (sticker) text = "";                                               // a sticker carries no caption, so no signature either
  if (!text && !ri) return { error: "empty post" };
  const full = text ? text + (footer ? `\n\n${footer}` : "") : "";
  if (ri && !sticker && full.length > 1000) return { error: "text+signature too long for a post with image (max 1000 chars): shorten or drop image_ref" };
  if (full.length > 3900) return { error: "text too long (max ~3900)" };
  return { text: full, image: ri?.image || "", sticker, refs: [fromRef, imageRef].filter(Boolean) };
}

// ------------------------------------------------------------------ the agent loop
interface RunResult { summary: string; posts: number; retryMin: number | null; error?: boolean }

const POST_PARAMS = {
  text: { type: "string", description: "post text; omit when forwarding a source post via from_ref" },
  from_ref: { type: "string", description: "ref of a source post: its full cleaned text is used as-is" },
  image_ref: { type: "string", description: "ref of a source post whose image/sticker to attach" },
};
const TOOLS = (final: boolean): ToolDef[] => [
  { type: "function", function: { name: "read_channel", description: "Latest unused posts of a PUBLIC Eitaa channel (@id), newest first, short previews. image/sticker=1 flags media.",
    parameters: { type: "object", properties: { channel: { type: "string" }, full: { type: "boolean", description: "longer previews (only if you must rewrite)" } }, required: ["channel"] } } },
  { type: "function", function: { name: "post_to_channel", description: "Publish to the owner's channel (his signature is appended by the system). Call it ONCE per post, all posts in the same step.",
    parameters: { type: "object", properties: { ...POST_PARAMS, delay_minutes: { type: "integer", description: "0-720; spread several posts" } } } } },
  ...(final ? [] : [{ type: "function" as const, function: { name: "retry_later", description: "The needed content does not exist YET (e.g. today's post not published). Retry the whole task later. Only if nothing was published.",
    parameters: { type: "object", properties: { minutes: { type: "integer", description: "5-30" }, reason: { type: "string" } }, required: ["minutes", "reason"] } } }]),
];

// ------------------------------------------------------------------ rule-based fallback (no model): used when every AI model is out of quota
const AD_RE = /تبلیغ|قرعه.?کشی|جایزه|تخفیف|فروش ویژه|ثبت.?نام|سفارش|خرید|کد تخفیف|عضو شوید|لینک عضویت|join|https?:\/\/t\.me|بنر/i;
const STOP = new Set("از در به با که را این آن برای و یا هر روز ساعت صبح ظهر شب کانال کانالم کانال‌های مطلب مطالب پست بیاور بگذار بذار بگیر درباره مفید باشد نباشد تبلیغ امروز تاریخ همان دقیقا دقیقاً چند یک دو سه بار بعد قبل خودت بنویس".split(/\s+/));
const words = (t: string) => normDigits(t).replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));

async function heuristicRun(env: Env, j: JobRow, t: number): Promise<RunResult> {
  const instr = j.instruction, srcs = [...new Set([...instr.matchAll(/@([A-Za-z0-9_.]{3,64})/g)].map((m) => m[1]))].filter((c) => c.toLowerCase() !== "").slice(0, MAX_CHANNELS_PER_RUN);
  if (!srcs.length) return { summary: "سهمیه‌ی هوش مصنوعی امروز تمام شده و این کار منبع مشخصی ندارد؛ فردا یا با دکمه‌ی «اجرا الان» دوباره تلاش می‌شود.", posts: 0, retryMin: null, error: true };
  const nm = normDigits(instr).match(/(\d)\s*(?:تا)?\s*(?:مطلب|پست|خبر|مورد)/), want = Math.min(nm ? +nm[1] : 1, 3);
  const needDate = /تاریخ/.test(instr), topic = new Set(words(instr.replace(/@\S+/g, "")));
  const st: ReadState = { channels: new Map(), refs: new Map() };
  const cands: { ref: string; score: number; r: RefInfo }[] = [];
  const recent = (await env.DB.prepare("SELECT text FROM ea_posts WHERE job_id=? AND created_at>? AND status IN ('pending','draft','sending','sent')").bind(j.id, t - 3 * 86400).all<{ text: string }>()).results;
  const recentNorm = new Set(recent.map((r) => norm(r.text).replace(/\s+/g, " ").slice(0, 120)));
  for (const c of srcs) {
    const res: any = await readChannel(env, st, { channel: c, limit: 20 }, j.id, MAX_CHANNELS_PER_RUN);
    for (const p of res.posts || []) {
      const r = st.refs.get(p.ref)!;
      if (r.sticker || AD_RE.test(r.text) || (r.text.length < 40 && !r.image)) continue;
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
    const p = resolvePost(st, { from_ref: c.ref, ...(c.r.image ? { image_ref: c.ref } : {}) }, j.footer);
    const q = "error" in p ? resolvePost(st, { from_ref: c.ref }, j.footer) : p;
    if ("error" in q) continue;
    const sig = norm(q.text).replace(/\s+/g, " ").slice(0, 120);
    if (recentNorm.has(sig)) continue;
    recentNorm.add(sig);
    const draft = !!j.approve;
    const ins = await env.DB.prepare("INSERT INTO ea_posts(user_id,channel_id,kind,text,file_id,file_name,title,silent,pin,view_delete,run_at,status,created_at,src_url,job_id) VALUES(?,?,?,?,'',?,'',0,0,0,?,?,?,?,?)")
      .bind(j.user_id, j.channel_id, q.image ? "file" : "text", q.text, "", now() + n * 20 * 60, draft ? "draft" : "pending", now(), q.image, j.id).run();
    await env.DB.prepare("INSERT OR IGNORE INTO agent_seen(job_id,k,seen_at) VALUES(?,?,?)").bind(j.id, c.ref, now()).run();
    if (draft) await tg.send(env, j.user_id, `📝 <b>پیش‌نویس ایجنت «${esc(j.name)}»</b> (#${ins.meta.last_row_id})\n\n${esc(q.text.slice(0, 1500))}`, ikb([[["✅ انتشار", `ag:go:${ins.meta.last_row_id}`], ["🗑 حذف", `ag:no:${ins.meta.last_row_id}`]]] as Btn[][]));
    n++;
  }
  return { summary: n ? `سهمیه‌ی هوش مصنوعی تمام بود؛ با موتور قانون‌محور ${n} پست انتخاب شد.` : "سهمیه‌ی هوش مصنوعی تمام بود و مطلب مناسبی با قوانین ساده پیدا نشد.", posts: n, retryMin: null };
}

async function runAgent(env: Env, j: JobRow, slot: Slot, final: boolean): Promise<RunResult> {
  const ch = await getChannel(env, j.channel_id);
  if (!ch || ch.user_id !== j.user_id) return { summary: "کانال مقصد دیگر وجود ندارد.", posts: 0, retryMin: null, error: true };
  const t0 = Date.now(), t = now(), l = toLocal(t);
  const recent = (await env.DB.prepare("SELECT text FROM ea_posts WHERE job_id=? AND created_at>? AND status IN ('pending','draft','sending','sent') ORDER BY id DESC LIMIT 6").bind(j.id, t - 3 * 86400).all<{ text: string }>()).results;
  const state = { posts: 0, retryMin: null as number | null, summary: "", done: false, channels: new Map<string, Awaited<ReturnType<typeof fetchChannel>>>(), refs: new Map<string, RefInfo>() };
  const recentNorm = new Set(recent.map((r) => norm(r.text).replace(/\s+/g, " ").slice(0, 120)));

  const system =
    `You run a task for an Eitaa channel owner. Reply/write in Persian. Use tools; be brief.\n` +
    `TASK:\n${j.instruction}\n\n` +
    `Today (Tehran): ${jalaliLong(t)} | ${l.y}-${pad2(l.mo)}-${pad2(l.d)} ${pad2(l.h)}:${pad2(l.mi)}\n` +
    `Rules: read only channels named in the task. Never invent posts. To forward a source post use post_to_channel(from_ref) — never retype it; `+
    `to rewrite, write text yourself (no source names/@ids/links). Skip ads/giveaways/off-topic. No near-duplicates of RECENT. "N posts" = maximum; fewer or none is fine. ` +
    `Spread several posts with delay_minutes. A required date must be today's; a source post showing another date is unacceptable. ` +
    (final ? "LAST attempt: if no suitable source post exists, write the post yourself per the task and publish it. " : "If the needed content does not exist yet and you published nothing, call retry_later. ") +
    `When done with nothing to publish, answer with one short Persian sentence explaining why.\n` +
    `RECENT:\n${recent.length ? recent.map((r) => `- ${r.text.replace(/\s+/g, " ").slice(0, 70)}`).join("\n") : "(none)"}`;

  let postedThisStep = 0;
  const exec = async (name: string, a: any): Promise<unknown> => {
    switch (name) {
      case "read_channel": return readChannel(env, state, a, j.id, MAX_CHANNELS_PER_RUN);
      case "post_to_channel": {
        if (state.posts >= MAX_POSTS_PER_RUN) return { error: "post limit for this run reached" };
        const p = resolvePost(state, a, j.footer);
        if ("error" in p) return p;
        const sig = norm(p.text).replace(/\s+/g, " ").slice(0, 120);
        if (sig && recentNorm.has(sig)) return { error: "duplicate of something already published" };
        const delay = Math.min(Math.max(parseInt(a.delay_minutes, 10) || 0, 0), 720), draft = !!j.approve;
        const ins = await env.DB.prepare("INSERT INTO ea_posts(user_id,channel_id,kind,text,file_id,file_name,title,silent,pin,view_delete,run_at,status,created_at,src_url,job_id) VALUES(?,?,?,?,'',?,'',0,0,0,?,?,?,?,?)")
          .bind(j.user_id, j.channel_id, p.image ? "file" : "text", p.text, p.sticker ? "sticker.webp" : "", now() + delay * 60, draft ? "draft" : "pending", now(), p.image, j.id).run();
        const postId = ins.meta.last_row_id as number;
        recentNorm.add(sig); state.posts++; postedThisStep++;
        const keys = [...new Set(p.refs)].filter((k) => /^[A-Za-z0-9_.]+\/\d+$/.test(k));
        if (keys.length) await env.DB.batch(keys.map((k) => env.DB.prepare("INSERT OR IGNORE INTO agent_seen(job_id,k,seen_at) VALUES(?,?,?)").bind(j.id, k, now())));
        if (draft) await tg.send(env, j.user_id, `📝 <b>پیش‌نویس ایجنت «${esc(j.name)}»</b> (#${postId})${p.image ? " 🖼" : ""}\n\n${esc(p.text.slice(0, 1500))}`, ikb([[["✅ انتشار", `ag:go:${postId}`], ["🗑 حذف", `ag:no:${postId}`]]] as Btn[][]));
        return { ok: true, post_id: postId };
      }
      case "retry_later": {
        if (final) return { error: "not allowed in the last attempt — publish now" };
        if (state.posts) return { error: "you already published in this run" };
        state.retryMin = Math.min(Math.max(parseInt(a.minutes, 10) || 10, 5), 30);
        state.summary = String(a.reason || "").slice(0, 300);
        state.done = true;
        return { ok: true };
      }
    }
    return { error: `unknown tool ${name}` };
  };

  const messages: ChatMsg[] = [{ role: "system", content: system }, { role: "user", content: "Go." }];
  const tools = TOOLS(final);
  for (let step = 0; step < MAX_STEPS && !state.done; step++) {
    if (Date.now() - t0 > RUN_BUDGET_MS) { state.summary ||= "زمان اجرا تمام شد."; break; }
    let m: ChatMsg;
    try { m = await chatTools(env, messages, tools, 45_000, 900); }
    catch (e) {
      if (step === 0 && !state.posts) return heuristicRun(env, j, t);      // every model failed (quota/outage): do the job with plain rules
      throw e;
    }
    messages.push(m);
    if (!m.tool_calls?.length) { state.summary ||= (m.content || "").trim().slice(0, 400); break; }
    postedThisStep = 0;
    for (const c of m.tool_calls) {
      let out: unknown;
      try { out = await exec(c.function.name, JSON.parse(c.function.arguments || "{}")); }
      catch (e) { out = { error: (e as Error).message }; }
      messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(out).slice(0, 12_000) });
    }
    if (postedThisStep > 0) { state.done = true; state.summary ||= `${state.posts} پست ساخته شد.`; }   // no extra "wrap-up" call: it would only cost tokens
  }
  if (!state.summary) state.summary = state.posts ? "انجام شد." : "کاری انجام نشد.";
  return { summary: state.summary, posts: state.posts, retryMin: state.retryMin };
}
