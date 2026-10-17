// Live conversation with the agent inside the bot: the owner talks, the agent acts right away with real tools
// (read a public channel, send to his channel and wait for the real delivery result, schedule) and reports what actually happened.
import { RefInfo, readChannel, resolvePost } from "./agent";
import { ChannelRow, UserRow, getSession, now, setSession, userChannels } from "./db";
import { Env } from "./env";
import { ChatMsg, ToolDef, chatTools } from "./llm";
import { llmReady } from "./providers";
import { deliver } from "./scheduler";
import { fetchChannel } from "./source";
import * as tg from "./tg";
import { TgMessage } from "./tg";
import { esc, fmtDt, jalaliLong, pad2, parseWhen, toLocal } from "./util";

type Ctx = { env: Env; wait: (p: Promise<unknown>) => void };
const MAX_STEPS = 6;
const BUDGET_MS = 42_000;
const STEP_TIMEOUT_MS = 20_000;
const HIST_KEEP = 6;

const INTRO = "💬 <b>گفتگوی زنده با ایجنت</b>\n\nهر چه می‌خواهید بنویسید؛ همان لحظه انجام می‌دهد و نتیجه‌ی واقعی را می‌گوید. مثلاً:\n" +
  "• <i>برای تست یک «سلام» توی کانالم بفرست</i>\n• <i>از کانال @name آخرین پست‌ها را نشانم بده</i>\n• <i>از @name یک استیکر تقویم پیدا کن و بفرست</i>\n• <i>فردا ساعت ۹ این متن را بگذار: …</i>\n\n" +
  "خروج: /cancel یا هر دکمه‌ی منو.";

export async function start(env: Env, u: UserRow): Promise<void> {
  if (!(await llmReady(env))) return void (await tg.send(env, u.id, "⏳ ایجنت هنوز فعال نشده است (بایندینگ AI در wrangler.jsonc فعال نیست)."));
  if (!u.eitaa_token_enc) return void (await tg.send(env, u.id, "ابتدا از «برنامه‌های متصل» توکن ایتایار را ثبت کنید."));
  if (!(await userChannels(env, u.id)).length) return void (await tg.send(env, u.id, "ابتدا از «کانال‌ها» کانال خودتان را اضافه کنید."));
  await setSession(env, u.id, "chat", { hist: [], last_mid: 0, busy_until: 0 });
  await tg.send(env, u.id, INTRO);
}

const TOOLS: ToolDef[] = [
  { type: "function", function: { name: "read_channel", description: "Latest posts of a PUBLIC Eitaa channel (@id), newest first, short previews (ref, text; image/sticker=1).",
    parameters: { type: "object", properties: { channel: { type: "string" } }, required: ["channel"] } } },
  { type: "function", function: { name: "send_to_me", description: "Show/send something to HIM in this Telegram chat (NOT to any channel): use for \"show me / send me / برام بفرست / نشانم بده\". Pass from_ref (full post text) and/or image_ref, or your own text.",
    parameters: { type: "object", properties: { text: { type: "string" }, from_ref: { type: "string" }, image_ref: { type: "string" } } } } },
  { type: "function", function: { name: "post_to_channel", description: "PUBLISH to one of HIS OWN channels NOW, only when he explicitly asks to post/publish/send something into his channel (کانالم). Never for \"send me\". The text must be real post content, never an instruction (real result is returned). To forward a source post pass from_ref (full text copied by the system) and/or image_ref (image or sticker; for a sticker omit text).",
    parameters: { type: "object", properties: { text: { type: "string" }, from_ref: { type: "string" }, image_ref: { type: "string" }, channel_id: { type: "integer", description: "optional if he has one channel" } } } } },
  { type: "function", function: { name: "schedule_post", description: "Schedule a text post. when: \"18:30\", \"فردا 09:00\", \"+45\" (minutes), \"1405/07/20 18:30\" (Tehran).",
    parameters: { type: "object", properties: { text: { type: "string" }, when: { type: "string" }, channel_id: { type: "integer" } }, required: ["text", "when"] } } },
];

export async function turn(c: Ctx, user: UserRow, m: TgMessage, text: string, data: Record<string, any>): Promise<void> {
  const { env } = c, uid = user.id, t0 = Date.now();
  if (!text) return void (await tg.send(env, uid, "در گفتگو فعلاً فقط پیام متنی می‌فهمم. (برای ارسال فایل از «✍️ پست جدید» استفاده کنید.)"));
  if (m.message_id <= (data.last_mid || 0)) return;                                  // Telegram re-delivery of a message already handled
  if ((data.busy_until || 0) > now()) return void (await tg.send(env, uid, "⏳ هنوز دارم پیام قبلی را انجام می‌دهم؛ چند ثانیه صبر کنید."));
  await setSession(env, uid, "chat", { ...data, last_mid: m.message_id, busy_until: now() + 70 });

  await tg.typing(env, uid);
  const mid = await tg.send(env, uid, "🤔 …");
  const show = (t: string) => (mid ? tg.edit(env, uid, mid, t) : Promise.resolve());

  const chans = await userChannels(env, uid);
  const st = { channels: new Map<string, Awaited<ReturnType<typeof fetchChannel>>>(), refs: new Map<string, RefInfo>() };
  const tnow = now(), l = toLocal(tnow);
  const system =
    `LIVE CHAT RULES. You are the live assistant of an Eitaa channel owner; chat in Persian, briefly. Act with tools immediately when he clearly asks (send, test message, read a channel, forward a sticker…); ask ONE short question only if something essential is missing. ` +
    `IMPORTANT: "برام/واسم/بهم/نشانم بده/به من بفرست" = show it to HIM in this chat → read_channel then send_to_me. Use post_to_channel ONLY when he clearly says to put/post/send into HIS channel (کانالم، توی کانال من). A channel he merely names (@x) is a source to read, not a destination. `+
    `Post exactly the text he asks, no signature unless asked. Only PUBLIC channels he names can be read (no global search). Use from_ref/image_ref to forward posts instead of retyping. ` +
    `Today (Tehran): ${jalaliLong(tnow)} | ${l.y}-${pad2(l.mo)}-${pad2(l.d)} ${pad2(l.h)}:${pad2(l.mi)}\n` +
    `HIS CHANNELS: ${chans.map((x) => `id=${x.id} «${x.title}» (@${x.chat_id})`).join("; ")}`;
  const hist: { r: "u" | "a"; t: string }[] = Array.isArray(data.hist) ? data.hist : [];
  const messages: ChatMsg[] = [{ role: "system", content: system }, ...hist.map((h) => ({ role: h.r === "u" ? "user" : "assistant", content: h.t }) as ChatMsg), { role: "user", content: text }];

  const pick = (id: unknown): ChannelRow | string => {
    if (id === undefined || id === null || id === "") return chans.length === 1 ? chans[0] : "specify channel_id (he has several channels: ask him which one)";
    return chans.find((x) => x.id === Number(id)) || "unknown channel_id";
  };
  const insert = async (ch: ChannelRow, kind: "text" | "file", body: string, file: string, name: string, runAt: number) =>
    (await env.DB.prepare("INSERT INTO ea_posts(user_id,channel_id,kind,text,file_id,file_name,title,silent,pin,view_delete,run_at,status,created_at,src_url) VALUES(?,?,?,?,'',?,'',0,0,0,?,'pending',?,?)")
      .bind(uid, ch.id, kind, body, name, runAt, now(), file).run()).meta.last_row_id as number;

  const toMe = /(واسم|برام|برایم|بهم|نشانم|نشونم|به من|برای من|بفرست برام)/.test(text) && !/(کانالم|کانال من|کانال خودم|داخل کانال من|توی کانال من)/.test(text);
  const tools = toMe ? TOOLS.filter((x) => x.function.name !== "post_to_channel" && x.function.name !== "schedule_post") : TOOLS;
  const notes: string[] = [];   // outcome lines written by the code itself (truthful, and no extra LLM round-trip)
  const exec = async (name: string, a: any): Promise<unknown> => {
    switch (name) {
      case "read_channel": { await show(`🔎 در حال خواندن @${esc(String(a.channel || ""))}…`); return readChannel(env, st, a, null, 4); }
      case "send_to_me": {
        const p = resolvePost(st, a, "");
        if ("error" in p) return { status: "failed", error: p.error };
        try {
          if (p.sticker && p.image) await tg.tg(env, "sendSticker", { chat_id: uid, sticker: p.image });
          else if (p.image) await tg.tg(env, "sendPhoto", { chat_id: uid, photo: p.image, caption: p.text.slice(0, 1000) });
          else await tg.send(env, uid, esc(p.text));
          if (p.image && !p.sticker && p.text.length > 1000) await tg.send(env, uid, esc(p.text));
        } catch (e) {
          if (p.text) await tg.send(env, uid, esc(p.text)); else return { status: "failed", error: (e as Error).message };
        }
        notes.push("📨 برای شما فرستاده شد.");
        return { status: "sent_to_user" };
      }
      case "post_to_channel": {
        const ch = pick(a.channel_id);
        if (typeof ch === "string") return { status: "failed", error: ch };
        const p = resolvePost(st, a, "");
        if ("error" in p) return { status: "failed", error: p.error };
        await show(`📤 در حال ارسال به «${esc(ch.title)}»…`);
        const id = await insert(ch, p.image ? "file" : "text", p.text, p.image, p.sticker ? "sticker.webp" : "", now());
        await deliver(env, id, true);
        const r = await env.DB.prepare("SELECT status, error FROM ea_posts WHERE id=?").bind(id).first<{ status: string; error: string }>();
        const ok = r?.status === "sent";
        notes.push(ok ? `✅ ${p.sticker ? "استیکر" : "پیام"} در «${esc(ch.title)}» ارسال شد.` : `❌ ارسال به «${esc(ch.title)}» نشد: ${esc(r?.error || "خطای نامشخص")}`);
        return ok ? { status: "sent" } : { status: "failed", error: r?.error || "unknown error" };
      }
      case "schedule_post": {
        const ch = pick(a.channel_id);
        if (typeof ch === "string") return { status: "failed", error: ch };
        const at = parseWhen(String(a.when || ""));
        const body = String(a.text || "").trim();
        if (at === null) return { status: "failed", error: "invalid or past time; use 18:30, فردا 09:00, +45, 1405/07/20 18:30" };
        if (!body || body.length > 3900) return { status: "failed", error: "empty or too long text" };
        await insert(ch, "text", body, "", "", at);
        notes.push(`⏰ برای ${fmtDt(at)} (وقت تهران) در «${esc(ch.title)}» زمان‌بندی شد.`);
        return { status: "scheduled" };
      }
    }
    return { error: `unknown tool ${name}` };
  };

  let answer = "", failedWhy = "";
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      if (Date.now() - t0 > BUDGET_MS) { answer = "⏱ زمان این درخواست تمام شد؛ اگر کار کامل نشد دوباره بگویید."; break; }
      const r = await chatTools(env, messages, tools, STEP_TIMEOUT_MS, 700);
      messages.push(r);
      if (!r.tool_calls?.length) { answer = esc((r.content || "").trim()); break; }
      let onlyActions = true;
      for (const call of r.tool_calls) {
        if (call.function.name === "read_channel") onlyActions = false;
        let out: unknown;
        try { out = await exec(call.function.name, JSON.parse(call.function.arguments || "{}")); } catch (e) { out = { error: (e as Error).message }; }
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out).slice(0, 12_000) });
      }
      // after publishing/scheduling the code reports the real outcome itself — no extra LLM call, no chance of a wrong "done"
      if (onlyActions && notes.length) { answer = (r.content ? esc(r.content.trim()) + "\n" : "") + notes.join("\n"); break; }
    }
  } catch (e) { failedWhy = (e as Error).message; }

  const final = failedWhy ? `❌ ${esc(failedWhy)}` : (notes.length && !answer.includes(notes[0]) ? [answer, ...notes] : [answer || "انجام شد."]).filter(Boolean).join("\n");
  if (mid) await tg.edit(env, uid, mid, final.slice(0, 4000)); else await tg.send(env, uid, final);
  const keep = [...hist, { r: "u" as const, t: text.slice(0, 300) }, { r: "a" as const, t: (failedWhy ? `(خطا: ${failedWhy})` : notes.length ? notes.join(" ") : answer).replace(/<[^>]+>/g, "").slice(0, 300) }].slice(-HIST_KEEP);
  const cur = await getSession(env, uid);
  if (cur.state === "chat") await setSession(env, uid, "chat", { hist: keep, last_mid: m.message_id, busy_until: 0 });
}
