import { enc } from "./crypto";
import { ChannelRow, PostRow, UserRow, clearSession, getChannel, getSession, getUser, now, setSession, touchUser, userChannels } from "./db";
import * as eitaa from "./eitaa";
import { Env, adminIds } from "./env";
import * as agentUi from "./agentui";
import * as chat from "./chat";
import { llmChain } from "./providers";
import { cleanText, fetchChannel } from "./source";
import { deliver } from "./scheduler";
import * as tg from "./tg";
import { Btn, Kb, TgCallback, TgMessage, TgUpdate, ikb } from "./tg";
import { esc, fmtDt, normalizeChatId, parseWhen } from "./util";

export const B = { NEW: "✍️ پست جدید", SCHED: "⏰ زمان‌بندی‌شده‌ها", AGENT: "🤖 ایجنت هوشمند", CHAT: "💬 گفتگو با ایجنت", CHAN: "📣 کانال‌ها", APPS: "🔌 برنامه‌های متصل", ME: "👤 حساب من", HELP: "💡 راهنما", ADMIN: "🛠 مدیریت", BACK: "🔙 بازگشت به هوش مصنوعی" };
const MENU = new Set(Object.values(B));
const MAX_FILE = 20 * 1024 * 1024;
const MAX_CHANNELS = 20;
type Ctx = { env: Env; wait: (p: Promise<unknown>) => void };

const mainKb = (admin: boolean) => ({
  keyboard: [[{ text: B.NEW }, { text: B.SCHED }], [{ text: B.CHAT }, { text: B.AGENT }], [{ text: B.CHAN }, { text: B.APPS }], [{ text: B.ME }, { text: B.HELP }], [{ text: B.BACK }, ...(admin ? [{ text: B.ADMIN }] : [])]],
  resize_keyboard: true,
});
const isAdmin = (env: Env, uid: number) => adminIds(env).includes(uid);
const hasAccess = (u: UserRow, admin: boolean, env?: Env) => admin || !!env?.EA_ACCESS || (!!u.expires_at && u.expires_at > now());
const NO_ACCESS = "🔒 اشتراک فعال ندارید.\nبرای فعال‌سازی با مدیر تماس بگیرید.";

// ------------------------------------------------------------------ entry
export async function handleUpdate(c: Ctx, u: TgUpdate): Promise<void> {
  if (u.callback_query) return onCallback(c, u.callback_query);
  if (u.message && u.message.chat.type === "private" && u.message.from) return onMessage(c, u.message);
}

async function onMessage(c: Ctx, m: TgMessage): Promise<void> {
  const { env } = c, uid = m.from!.id, admin = isAdmin(env, uid);
  const user = await touchUser(env, uid, m.from!.first_name || "", m.from!.username || "");
  if (user.banned && !admin) return void (await tg.send(env, uid, "⛔️ دسترسی شما مسدود شده است."));
  const text = (m.text || "").trim();

  if (text.startsWith("/")) {
    const [cmd, ...args] = text.split(/\s+/);
    switch (cmd.split("@")[0].toLowerCase()) {
      case "/start": await clearSession(env, uid); return void (await tg.send(env, uid, welcome(env, user, admin), mainKb(admin)));
      case "/cancel": await clearSession(env, uid); return void (await tg.send(env, uid, "لغو شد.", mainKb(admin)));
      case "/help": return void (await tg.send(env, uid, HELP, mainKb(admin)));
      default: if (admin) { const r = await adminCmd(env, cmd.toLowerCase(), args); if (r) return void (await tg.send(env, uid, r)); }
    }
    return void (await tg.send(env, uid, "دستور نامعتبر است. /help"));
  }
  if (MENU.has(text)) {                       // menu buttons work from any state and reset it
    await clearSession(env, uid);
    return menu(c, user, admin, text);
  }
  const s = await getSession(env, uid);
  if (!hasAccess(user, admin, env) && s.state) { await clearSession(env, uid); return void (await tg.send(env, uid, NO_ACCESS)); }
  switch (s.state) {
    case "token": return gotToken(c, user, m, text);
    case "chan_id": return gotChanId(c, user, text);
    case "chan_title": return gotChanTitle(c, user, s.data, text);
    case "chan_rename": return gotRename(c, user, s.data, text);
    case "np_content": return gotContent(c, user, s.data, m);
    case "np_title": return gotNpField(c, user, s.data, "title", text);
    case "np_view": return gotNpField(c, user, s.data, "view", text);
    case "np_when": return gotWhen(c, user, s.data, text);
  }
  if (s.state === "chat") return chat.turn(c, user, m, text, s.data);
  if (s.state.startsWith("ag_")) return agentUi.onText(c, user, admin, s.state, s.data, text);
  await tg.send(env, uid, "از منوی پایین استفاده کنید.", mainKb(admin));
}

async function menu(c: Ctx, user: UserRow, admin: boolean, text: string): Promise<void> {
  const { env } = c, uid = user.id;
  if (text === B.HELP) return void (await tg.send(env, uid, HELP, mainKb(admin)));
  if (text === B.ADMIN) return admin ? adminPanel(env, uid) : undefined;
  if (!hasAccess(user, admin, env)) return void (await tg.send(env, uid, NO_ACCESS));
  switch (text) {
    case B.NEW: return newPost(c, user);
    case B.SCHED: return scheduled(env, uid);
    case B.AGENT: return agentUi.home(env, user);
    case B.CHAT: return chat.start(env, user);
    case B.CHAN: return channels(env, uid);
    case B.APPS: return apps(env, user);
    case B.ME: return account(env, user, admin);
  }
}

const welcome = (env: Env, u: UserRow, admin: boolean) =>
  `سلام ${esc(u.name || "")} 👋\n\n✨ پست فوری، زمان‌بندی‌شده و ایجنت هوشمند برای کانال‌های <b>ایتا</b>، از همین‌جا.\n\n` +
  (hasAccess(u, admin, env) ? "از منوی پایین شروع کنید 👇" : NO_ACCESS);
const HELP = "<b>💡 راهنما</b>\n\n" +
  "1️⃣ <b>برنامه‌های متصل</b>: توکن ایتایار را ثبت کنید\n" +
  "2️⃣ <b>کانال‌ها</b>: کانال را اضافه کنید (حساب یا ربات باید در کانال ادمین باشد)\n" +
  "3️⃣ <b>پست جدید</b>: کانال را انتخاب و متن یا فایل (تا ۲۰ مگابایت) را بفرستید؛ سپس ارسال یا زمان‌بندی\n\n" +
  "💬 <b>گفتگو با ایجنت</b>: زنده با ایجنت حرف بزنید؛ همان لحظه کار را انجام می‌دهد و نتیجه را می‌گوید\n" +
  "🤖 <b>ایجنت هوشمند</b>: با زبان ساده بگویید چه کاری و چه ساعتی انجام شود (مثلاً از کانال‌های عمومی محتوا بیاورد یا هر صبح پیام صبح‌بخیر بگذارد)\n\n" +
  "⏱ نمونه زمان: <code>18:30</code> · <code>فردا 09:00</code> · <code>+45</code> · <code>1405/07/20 18:30</code>";

// ------------------------------------------------------------------ token
async function apps(env: Env, u: UserRow): Promise<void> {
  const has = !!u.eitaa_token_enc;
  const rows: Btn[][] = [[[has ? "🔑 تغییر توکن ایتایار" : "🔑 ثبت توکن ایتایار", "tk:set"]]];
  if (has) rows.push([["🗑 حذف توکن ایتایار", "tk:del"]]);
  await tg.send(env, u.id, `<b>🔌 برنامه‌های متصل</b>\n\n🟠 ایتایار: ${has ? "✅ متصل" + (u.eitaa_account ? ` (${esc(u.eitaa_account)})` : "") : "❌ متصل نیست"}`, ikb(rows));
}
async function gotToken(c: Ctx, u: UserRow, m: TgMessage, text: string): Promise<void> {
  const { env } = c;
  await tg.del(env, u.id, m.message_id);
  const token = text.replace(/^bot/i, "").trim();
  if (!/^[A-Za-z0-9:_\-]{8,200}$/.test(token)) return void (await tg.send(env, u.id, "❌ قالب توکن درست نیست. دوباره بفرستید (یا /cancel)."));
  let me: any;
  try { me = await eitaa.getMe(env, token); } catch (e) {
    return void (await tg.send(env, u.id, `❌ ایتایار توکن را نپذیرفت: ${esc((e as Error).message)}\nدوباره بفرستید (یا /cancel).`));
  }
  const account = String(me?.username || me?.first_name || me?.name || "").slice(0, 60);
  await env.DB.prepare("UPDATE ea_users SET eitaa_token_enc=?, eitaa_account=? WHERE id=?").bind(await enc(env.SECRET_KEY, token), account, u.id).run();
  await clearSession(env, u.id);
  await tg.send(env, u.id, "✅ توکن ایتایار ثبت شد 🎉", mainKb(isAdmin(env, u.id)));
}

// ------------------------------------------------------------------ channels
async function channels(env: Env, uid: number): Promise<void> {
  const list = await userChannels(env, uid);
  await tg.send(env, uid, list.length ? "<b>📣 کانال‌های شما</b>" : "📭 هنوز کانالی اضافه نکرده‌اید.",
    ikb([...list.map((ch) => [[`🟠 ${ch.title}`.slice(0, 40), `ch:v:${ch.id}`] as Btn]), [["🟠 افزودن کانال ایتا", "ch:add"]]]));
}
async function gotChanId(c: Ctx, u: UserRow, text: string): Promise<void> {
  const { env } = c, cid = normalizeChatId(text);
  if (!cid || cid.length < 3 || /\s/.test(cid)) return void (await tg.send(env, u.id, "آیدی یا لینک معتبر نیست. دوباره بفرستید (یا /cancel)."));
  if ((await userChannels(env, u.id)).some((x) => x.chat_id.toLowerCase() === cid.toLowerCase()))
    return void (await tg.send(env, u.id, "این کانال قبلاً اضافه شده است."));
  const info = await eitaa.lookupChat(env, cid);
  if (info.exists === false) return void (await tg.send(env, u.id, "❌ چنین کانالی در ایتا پیدا نشد. آیدی را بررسی کنید (یا /cancel)."));
  if (info.title) return saveChannel(c, u, cid, info.title);
  await setSession(env, u.id, "chan_title", { chat_id: cid });
  await tg.send(env, u.id, "نام نمایشی برای این کانال را بفرستید (فقط برای خودتان):");
}
async function gotChanTitle(c: Ctx, u: UserRow, d: Record<string, any>, text: string): Promise<void> {
  if (!text) return;
  await saveChannel(c, u, String(d.chat_id), text.slice(0, 100));
}
async function saveChannel(c: Ctx, u: UserRow, chatId: string, title: string): Promise<void> {
  const { env } = c;
  if ((await userChannels(env, u.id)).length >= MAX_CHANNELS) { await clearSession(env, u.id); return void (await tg.send(env, u.id, `حداکثر ${MAX_CHANNELS} کانال مجاز است.`)); }
  await env.DB.prepare("INSERT INTO ea_channels(user_id,chat_id,title,platform,created_at) VALUES(?,?,?,?,?)").bind(u.id, chatId, title, "eitaa", now()).run();
  await clearSession(env, u.id);
  await tg.send(env, u.id, `✅ کانال «${esc(title)}» اضافه شد.\n📌 یادتان باشد حساب ایتایار باید در این کانال ادمین باشد.`, mainKb(isAdmin(env, u.id)));
}
async function gotRename(c: Ctx, u: UserRow, d: Record<string, any>, text: string): Promise<void> {
  if (!text) return;
  await c.env.DB.prepare("UPDATE ea_channels SET title=? WHERE id=? AND user_id=?").bind(text.slice(0, 100), d.channel_id, u.id).run();
  await clearSession(c.env, u.id);
  await tg.send(c.env, u.id, "✅ نام تغییر کرد.", mainKb(isAdmin(c.env, u.id)));
}

// ------------------------------------------------------------------ new post
async function newPost(c: Ctx, u: UserRow): Promise<void> {
  const { env } = c;
  const list = await userChannels(env, u.id);
  if (!list.length) return void (await tg.send(env, u.id, u.eitaa_token_enc ? "ابتدا از «کانال‌ها» یک کانال اضافه کنید." : "ابتدا از «برنامه‌های متصل» توکن ایتایار را وصل و از «کانال‌ها» یک کانال اضافه کنید."));
  if (list.length === 1) return askContent(env, u.id, list[0]);
  await tg.send(env, u.id, "در کدام کانال؟", ikb(list.map((ch) => [[`🟠 ${ch.title}`.slice(0, 40), `np:c:${ch.id}`] as Btn])));
}
async function askContent(env: Env, uid: number, ch: ChannelRow): Promise<void> {
  if (!(await getUser(env, uid))?.eitaa_token_enc) return void (await tg.send(env, uid, "ابتدا از «برنامه‌های متصل» توکن ایتایار را ثبت کنید."));
  await setSession(env, uid, "np_content", { channel_id: ch.id, silent: 0, pin: 0, view: 0, title: "" });
  await tg.send(env, uid, `🟠 کانال: <b>${esc(ch.title)}</b>\n✍️ متن یا فایل (عکس، ویدیو، سند، صدا؛ تا ۲۰ مگابایت) را بفرستید. لغو: /cancel`);
}

export function extract(m: TgMessage): { kind: "text" | "file"; text: string; file_id: string; file_name: string } | { error: string } {
  const cap = (m.caption || "").trim();
  if (m.photo?.length) { const p = m.photo[m.photo.length - 1]; return fileOf(p.file_id, "photo.jpg", p.file_size, cap); }
  for (const [key, def] of [["video", "video.mp4"], ["document", "file"], ["audio", "audio.mp3"], ["voice", "voice.ogg"], ["animation", "animation.mp4"]] as const) {
    const f = (m as any)[key];
    if (f) return fileOf(f.file_id, f.file_name || def, f.file_size, cap);
  }
  if (m.sticker) return { error: "استیکر پشتیبانی نمی‌شود." };
  if (m.text) return { kind: "text", text: m.text.trim(), file_id: "", file_name: "" };
  return { error: "این نوع پیام پشتیبانی نمی‌شود؛ متن یا فایل بفرستید." };
}
const fileOf = (id: string, name: string, size: number | undefined, cap: string) =>
  size && size > MAX_FILE ? { error: "حجم فایل بیش از ۲۰ مگابایت است (محدودیت ربات‌های تلگرام)." } : { kind: "file" as const, text: cap, file_id: id, file_name: name };

async function gotContent(c: Ctx, u: UserRow, d: Record<string, any>, m: TgMessage): Promise<void> {
  const r = extract(m);
  if ("error" in r) return void (await tg.send(c.env, u.id, "❌ " + r.error));
  const data = { ...d, kind: r.kind, text: r.text, file_id: r.file_id, file_name: r.file_name };
  await setSession(c.env, u.id, "np_menu", data);
  await showMenu(c.env, u.id, data);
}
const onoff = (v: number | boolean) => (v ? "روشن" : "خاموش");
async function showMenu(env: Env, uid: number, d: Record<string, any>, mid?: number): Promise<void> {
  const ch = await getChannel(env, d.channel_id);
  const preview = d.kind === "file" ? `📎 ${esc(d.file_name)}${d.text ? "\n" + esc(d.text.slice(0, 300)) : ""}` : esc(String(d.text).slice(0, 400));
  const t = `<b>👀 پیش‌نمایش</b> (🟠 ${esc(ch?.title || "?")})\n\n${preview}${d.title ? `\n\n🏷 عنوان: ${esc(d.title)}` : ""}`;
  const rows: Btn[][] = [[["🚀 ارسال الان", "np:now"], ["⏰ زمان‌بندی", "np:sch"]],
    [[`🔕 بی‌صدا: ${onoff(d.silent)}`, "np:silent"], [`📌 پین: ${onoff(d.pin)}`, "np:pin"]],
    [["🏷 عنوان", "np:title"], [`👁 حذف پس از بازدید: ${d.view || "خاموش"}`, "np:view"]]];
  rows.push([["❌ لغو", "np:x"]]);
  if (mid) await tg.edit(env, uid, mid, t, ikb(rows)); else await tg.send(env, uid, t, ikb(rows));
}
async function gotNpField(c: Ctx, u: UserRow, d: Record<string, any>, field: "title" | "view", text: string): Promise<void> {
  if (field === "view") {
    const n = parseInt(text.replace(/[۰-۹]/g, (x) => String(x.charCodeAt(0) - 0x06f0)), 10);
    if (isNaN(n) || n < 0 || n > 1_000_000) return void (await tg.send(c.env, u.id, "یک عدد بفرستید (۰ = خاموش)."));
    d.view = n;
  } else d.title = text.slice(0, 100);
  await setSession(c.env, u.id, "np_menu", d);
  await showMenu(c.env, u.id, d);
}
async function createPost(env: Env, uid: number, d: Record<string, any>, runAt: number): Promise<number> {
  const r = await env.DB.prepare("INSERT INTO ea_posts(user_id,channel_id,kind,text,file_id,file_name,title,silent,pin,view_delete,run_at,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending',?)")
    .bind(uid, d.channel_id, d.kind, d.text || "", d.file_id || "", d.file_name || "", d.title || "", d.silent ? 1 : 0, d.pin ? 1 : 0, d.view || 0, runAt, now()).run();
  return r.meta.last_row_id as number;
}
async function gotWhen(c: Ctx, u: UserRow, d: Record<string, any>, text: string): Promise<void> {
  const at = parseWhen(text);
  if (at === null) return void (await tg.send(c.env, u.id, "❌ زمان نامعتبر یا گذشته است. نمونه: <code>فردا 09:00</code> یا <code>+45</code>"));
  const id = await createPost(c.env, u.id, d, at);
  await clearSession(c.env, u.id);
  await tg.send(c.env, u.id, `✅ پست #${id} برای ${fmtDt(at)} (وقت تهران) زمان‌بندی شد.`, mainKb(isAdmin(c.env, u.id)));
}

// ------------------------------------------------------------------ scheduled list / account / admin
async function scheduled(env: Env, uid: number): Promise<void> {
  const rows = (await env.DB.prepare("SELECT * FROM ea_posts WHERE user_id=? AND status='pending' ORDER BY run_at LIMIT 10").bind(uid).all<PostRow>()).results;
  if (!rows.length) return void (await tg.send(env, uid, "پست زمان‌بندی‌شده‌ای ندارید."));
  for (const p of rows) {
    const preview = p.kind === "file" ? `📎 ${p.file_name}` : p.text.slice(0, 80);
    await tg.send(env, uid, `⏰ #${p.id} · ${fmtDt(p.run_at)}\n${esc(preview)}`, ikb([[["🗑 لغو", `sp:del:${p.id}`]]]));
  }
}
async function account(env: Env, u: UserRow, admin: boolean): Promise<void> {
  const n = (await userChannels(env, u.id)).length;
  await tg.send(env, u.id, `<b>👤 حساب من</b>\n\n🆔 شناسه: <code>${u.id}</code>\n💎 اشتراک: ${admin ? "مدیر" : u.expires_at && u.expires_at > now() ? "تا " + fmtDt(u.expires_at) : "غیرفعال"}\n` +
    `🟠 توکن ایتایار: ${u.eitaa_token_enc ? "✅" : "❌"}\n📣 کانال‌ها: ${n}`);
}
async function adminPanel(env: Env, uid: number): Promise<void> {
  const chain = await llmChain(env);
  await tg.send(env, uid, (await adminCmd(env, "/stats", [])) + `\n\n🧠 هوش مصنوعی ایجنت: ${chain.length ? "✅ " + chain.map((x) => x.name).join(" ← ") : "❌ بایندینگ AI در wrangler.jsonc فعال نیست"}\n\n<code>/grant ID DAYS</code> · <code>/ban ID</code> · <code>/unban ID</code> · <code>/stats</code> · <code>/src نام_کانال</code>`);
}
async function adminCmd(env: Env, cmd: string, a: string[]): Promise<string> {
  const id = parseInt(a[0] || "", 10);
  switch (cmd) {
    case "/stats": {
      const g = async (q: string) => (await env.DB.prepare(q).first<{ n: number }>())!.n;
      return `📊 کاربران: ${await g("SELECT COUNT(*) n FROM ea_users")} · فعال: ${await g(`SELECT COUNT(*) n FROM ea_users WHERE expires_at>${now()}`)}\n` +
        `پست‌ها — در انتظار: ${await g("SELECT COUNT(*) n FROM ea_posts WHERE status='pending'")} · ارسال‌شده: ${await g("SELECT COUNT(*) n FROM ea_posts WHERE status='sent'")} · ناموفق: ${await g("SELECT COUNT(*) n FROM ea_posts WHERE status='failed'")}`;
    }
    case "/grant": {
      const days = parseInt(a[1] || "", 10);
      if (!id || !days || days < 1 || days > 3650) return "استفاده: /grant ID DAYS";
      const u = await getUser(env, id);
      if (!u) return "این کاربر هنوز ربات را باز نکرده است.";
      const base = u.expires_at && u.expires_at > now() ? u.expires_at : now();
      const until = base + days * 86400;
      await env.DB.prepare("UPDATE ea_users SET expires_at=? WHERE id=?").bind(until, id).run();
      await tg.send(env, id, `✅ اشتراک شما تا ${fmtDt(until)} فعال شد.`);
      return `✅ ${id} تا ${fmtDt(until)} فعال شد.`;
    }
    case "/src": {   // diagnostics: what does the agent see on a public Eitaa channel page?
      const name = normalizeChatId(a[0] || "");
      if (!name) return "استفاده: /src channelname";
      const r = await fetchChannel(env, name);
      const m = r.messages[r.messages.length - 1];
      return `🔬 ${esc(name)} — HTTP ${r.status} — پیام‌های شناسایی‌شده: ${r.messages.length} (عکس: ${r.messages.filter((x) => x.image && !x.sticker).length}، استیکر: ${r.messages.filter((x) => x.sticker).length})${r.title ? `\nعنوان: ${esc(r.title)}` : ""}${r.note ? `\n⚠️ ${esc(r.note)}` : ""}` +
        (m ? `\n\nآخرین پیام (#${m.id}${m.image ? " 🖼" : ""}):\n${esc(cleanText(m.text, name, r.title).slice(0, 500))}` : `\n\nنمونه‌ی متن صفحه:\n${esc(r.snippet)}`);
    }
    case "/ban": case "/unban": {
      if (!id) return `استفاده: ${cmd} ID`;
      await env.DB.prepare("UPDATE ea_users SET banned=? WHERE id=?").bind(cmd === "/ban" ? 1 : 0, id).run();
      return cmd === "/ban" ? `⛔️ ${id} مسدود شد.` : `✅ ${id} آزاد شد.`;
    }
  }
  return "";
}

// ------------------------------------------------------------------ callbacks
async function onCallback(c: Ctx, q: TgCallback): Promise<void> {
  const { env } = c, uid = q.from.id, admin = isAdmin(env, uid), mid = q.message?.message_id;
  const user = await touchUser(env, uid, q.from.first_name || "", q.from.username || "");
  if ((user.banned && !admin) || !hasAccess(user, admin, env)) return tg.answer(env, q.id, "دسترسی ندارید.", true);
  const [kind, act, arg] = (q.data || "").split(":");
  const s = await getSession(env, uid);

  if (kind === "tk") {
    await tg.answer(env, q.id);
    if (act === "set") { await setSession(env, uid, "token", {}); return void (await tg.send(env, uid, "🔑 توکن ایتایار را بفرستید\n🧹 پیام شما بعد از خواندن پاک می‌شود. لغو: /cancel")); }
    if (act === "del") { await env.DB.prepare("UPDATE ea_users SET eitaa_token_enc='', eitaa_account='' WHERE id=?").bind(uid).run(); return void (await tg.send(env, uid, "🗑 توکن حذف شد.")); }
  }
  if (kind === "ag") return agentUi.onCallback(c, user, admin, q, act, arg, s);
  if (kind === "ch") {
    await tg.answer(env, q.id);
    if (act === "add") { await setSession(env, uid, "chan_id", {}); return void (await tg.send(env, uid, "آیدی یا لینک کانال ایتا را بفرستید. مثال: <code>@mychannel</code> یا <code>https://eitaa.com/mychannel</code>")); }
    const ch = await getChannel(env, Number(arg));
    if (!ch || ch.user_id !== uid) return;
    if (act === "v") return void (await tg.send(env, uid, `<b>${esc(ch.title)}</b>\n<code>${esc(ch.chat_id)}</code>`, ikb([[["✏️ تغییر نام", `ch:rn:${ch.id}`], ["🗑 حذف", `ch:del:${ch.id}`]]])));
    if (act === "rn") { await setSession(env, uid, "chan_rename", { channel_id: ch.id }); return void (await tg.send(env, uid, "نام جدید را بفرستید:")); }
    if (act === "del") return void (await tg.send(env, uid, `«${esc(ch.title)}» حذف شود؟ (پست‌های زمان‌بندی‌شده و ایجنت‌های آن هم حذف می‌شوند)`, ikb([[["✅ بله، حذف", `ch:dy:${ch.id}`], ["خیر", "ch:no:0"]]])));
    if (act === "dy") {
      await env.DB.batch([env.DB.prepare("UPDATE ea_posts SET status='canceled' WHERE channel_id=? AND status IN ('pending','draft')").bind(ch.id), env.DB.prepare("DELETE FROM agent_jobs WHERE channel_id=?").bind(ch.id), env.DB.prepare("DELETE FROM ea_channels WHERE id=?").bind(ch.id)]);
      return void (await tg.send(env, uid, "🗑 حذف شد."));
    }
    return;
  }
  if (kind === "sp" && act === "del") {
    const r = await env.DB.prepare("UPDATE ea_posts SET status='canceled' WHERE id=? AND user_id=? AND status='pending'").bind(Number(arg), uid).run();
    await tg.answer(env, q.id, r.meta.changes ? "لغو شد." : "قابل لغو نیست.");
    if (mid && r.meta.changes) await tg.edit(env, uid, mid, `🗑 پست #${arg} لغو شد.`);
    return;
  }
  if (kind === "np") {
    if (act === "c") {
      await tg.answer(env, q.id);
      const ch = await getChannel(env, Number(arg));
      return ch && ch.user_id === uid ? askContent(env, uid, ch) : undefined;
    }
    if (act === "x") { await clearSession(env, uid); await tg.answer(env, q.id, "لغو شد."); return void (mid && (await tg.edit(env, uid, mid, "لغو شد."))); }
    if (s.state !== "np_menu" && s.state !== "np_when") return tg.answer(env, q.id, "این پیش‌نویس منقضی شده؛ دوباره «پست جدید» بزنید.", true);
    const d = s.data;
    if (act === "silent" || act === "pin") { d[act] = d[act] ? 0 : 1; await setSession(env, uid, "np_menu", d); await tg.answer(env, q.id); return mid ? showMenu(env, uid, d, mid) : undefined; }
    if (act === "title") { await tg.answer(env, q.id); await setSession(env, uid, "np_title", d); return void (await tg.send(env, uid, "عنوان پست را بفرستید:")); }
    if (act === "view") { await tg.answer(env, q.id); await setSession(env, uid, "np_view", d); return void (await tg.send(env, uid, "پس از چند بازدید پست حذف شود؟ عدد بفرستید (۰ = خاموش):")); }
    if (act === "sch") { await tg.answer(env, q.id); await setSession(env, uid, "np_when", d); return void (await tg.send(env, uid, "⏰ زمان انتشار (وقت تهران):\n<code>18:30</code> · <code>فردا 09:00</code> · <code>+45</code> · <code>1405/07/20 18:30</code>\nلغو: /cancel")); }
    if (act === "now") {
      const id = await createPost(env, uid, d, now());
      await clearSession(env, uid);
      await tg.answer(env, q.id, "در حال ارسال…");
      if (d.kind === "file") {
        // big uploads can outlive waitUntil's ~30 s grace period; the cron tick has no such limit, so it picks them up (<= 1 min)
        if (mid) await tg.edit(env, uid, mid, `🚀 پست #${id} در صف ارسال قرار گرفت (حداکثر تا یک دقیقه‌ی دیگر ارسال می‌شود)…`);
      } else {
        if (mid) await tg.edit(env, uid, mid, `🚀 پست #${id} در حال ارسال…`);
        c.wait(deliver(env, id));
      }
    }
  }
}
