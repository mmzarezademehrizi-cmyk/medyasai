// Telegram UI of the agent: list, create (free-text task -> plan -> confirm), edit, run now, approve drafts.
import { Plan, describeSchedule, parseJson, parseTimes, planJob } from "./agent";
import { JobRow, UserRow, getChannel, getJob, now, setSession, clearSession, userChannels, userJobs } from "./db";
import { Env } from "./env";
import { llmReady } from "./providers";
import * as tg from "./tg";
import { Btn, TgCallback, ikb } from "./tg";
import { esc, slotKey } from "./util";

type Ctx = { env: Env; wait: (p: Promise<unknown>) => void };
const MAX_JOBS = 5;

const GUIDE =
  "✍️ <b>به ایجنت بگویید چه کاری انجام دهد</b> (با زبان ساده، هر چه می‌خواهید):\n\n" +
  "• <i>هر روز ساعت ۷ صبح از کانال @goodmorning_ch پیام صبح‌بخیر امروز را (همان که تاریخ امروز دارد) در کانالم بگذار</i>\n" +
  "• <i>روزی ۳ بار، ساعت ۹ و ۱۴ و ۲۰، از کانال‌های @a و @b دو مطلب مفید درباره‌ی ورزش بیاور؛ تبلیغ نباشد</i>\n" +
  "• <i>هر شب ساعت ۲۱ یک جمله‌ی انگیزشی کوتاه خودت بنویس و بگذار</i>\n\n" +
  "ساعت، روز و کانال‌های منبع را داخل همین متن بنویسید. (فقط کانال‌های <b>عمومی</b> ایتا خوانده می‌شوند.)\nلغو: /cancel";

// ------------------------------------------------------------------ list
export async function home(env: Env, u: UserRow): Promise<void> {
  const ready = await llmReady(env);
  if (!ready) return void (await tg.send(env, u.id, "⏳ ایجنت هوشمند هنوز فعال نشده است (بایندینگ AI در wrangler.jsonc فعال نیست)."));
  const jobs = await userJobs(env, u.id);
  const rows: Btn[][] = jobs.map((j) => [[`${j.enabled ? "🟢" : "⚪️"} ${j.name || "ایجنت " + j.id}`.slice(0, 40), `ag:v:${j.id}`] as Btn]);
  if (jobs.length < MAX_JOBS) rows.push([["➕ ایجنت جدید", "ag:new"]]);
  await tg.send(env, u.id, jobs.length ? "<b>🤖 ایجنت‌های شما</b>" : "🤖 <b>ایجنت هوشمند</b>\nکاری که می‌خواهید خودکار انجام شود را به زبان ساده بگویید؛ ایجنت در ساعت تعیین‌شده آن را انجام می‌دهد.", ikb(rows));
}

const view = async (env: Env, j: JobRow): Promise<{ text: string; kb: ReturnType<typeof ikb> }> => {
  const ch = await getChannel(env, j.channel_id);
  return {
    text: `<b>🤖 ${esc(j.name || "ایجنت")}</b> ${j.enabled ? "🟢 فعال" : "⚪️ غیرفعال"}\n\n` +
      `📣 کانال مقصد: ${esc(ch?.title || "؟")}\n⏰ ${esc(describeSchedule(j))}\n` +
      `✅ تأیید دستی قبل از انتشار: ${j.approve ? "روشن" : "خاموش"}\n🖋 امضا: ${j.footer ? "\n<code>" + esc(j.footer.slice(0, 200)) + "</code>" : "ندارد"}\n\n` +
      `📝 دستور:\n${esc(j.instruction.slice(0, 700))}` + (j.last_info ? `\n\n🕘 آخرین اجرا: ${esc(j.last_info)}` : ""),
    kb: ikb([
      [["▶️ اجرا الان", `ag:run:${j.id}`], [j.enabled ? "⏸ توقف" : "▶️ فعال‌سازی", `ag:tg:${j.id}`]],
      [["✏️ دستور", `ag:ed:${j.id}`], ["⏰ زمان‌ها", `ag:tm:${j.id}`], ["🖋 امضا", `ag:ft:${j.id}`]],
      [[`✅ تأیید دستی: ${j.approve ? "روشن" : "خاموش"}`, `ag:ap:${j.id}`]],
      [["🗑 حذف", `ag:del:${j.id}`]],
    ]),
  };
};
async function show(env: Env, uid: number, j: JobRow, mid?: number): Promise<void> {
  const v = await view(env, j);
  if (mid) await tg.edit(env, uid, mid, v.text, v.kb); else await tg.send(env, uid, v.text, v.kb);
}

// ------------------------------------------------------------------ create flow
async function askInstruction(env: Env, uid: number, data: Record<string, any>): Promise<void> {
  await setSession(env, uid, "ag_instr", data);
  await tg.send(env, uid, GUIDE);
}
async function confirm(env: Env, uid: number, d: Record<string, any>): Promise<void> {
  const plan: Plan = d.plan, ch = await getChannel(env, d.channel_id);
  const sched = describeSchedule({ times: JSON.stringify(plan.times), days: plan.days ? JSON.stringify(plan.days) : null, once_at: plan.onceAt });
  await setSession(env, uid, "ag_confirm", d);
  await tg.send(env, uid,
    `<b>🤖 ${esc(plan.name)}</b>\n\n${esc(plan.summary)}\n\n📣 کانال مقصد: ${esc(ch?.title || "؟")}\n⏰ ${esc(sched)}\n🖋 امضا: ${d.footer ? "\n<code>" + esc(d.footer) + "</code>" : "ندارد"}\n\nبرای ساخت تأیید کنید 👇`,
    ikb([[["✅ ساخت ایجنت", "ag:mk"], ["✏️ تغییر دستور", "ag:redo"]], [["❌ لغو", "ag:x"]]]));
}
async function createJob(env: Env, uid: number, d: Record<string, any>): Promise<JobRow> {
  const plan: Plan = d.plan, t = now();
  const r = await env.DB.prepare("INSERT INTO agent_jobs(user_id,channel_id,name,instruction,times,days,once_at,footer,last_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .bind(uid, d.channel_id, plan.name, d.instruction, JSON.stringify(plan.times), plan.days ? JSON.stringify(plan.days) : null, plan.onceAt, d.footer || "",
      plan.onceAt ? "" : slotKey(t), t).run();   // daily: today's already-passed slots count as done (no surprise backlog)
  return (await getJob(env, r.meta.last_row_id as number))!;
}

const WHEN_HELP = "⏰ ساعت اجرا را بفرستید (وقت تهران)، مثلاً <code>07:00</code> یا <code>09:00 14:00 20:00</code> (هر روز).\nبرای یک‌بار اجرا همین الان: <code>الان</code>";

export async function onText(c: Ctx, user: UserRow, admin: boolean, state: string, d: Record<string, any>, text: string): Promise<void> {
  const { env } = c, uid = user.id;
  switch (state) {
    case "ag_instr": {
      if (text.length < 10) return void (await tg.send(env, uid, "دستور خیلی کوتاه است؛ کمی کامل‌تر بنویسید (یا /cancel)."));
      if (text.length > 2000) return void (await tg.send(env, uid, "دستور بیش از ۲۰۰۰ نویسه است؛ کوتاه‌ترش کنید."));
      d.instruction = text;
      await setSession(env, uid, "ag_footer", d);
      return void (await tg.send(env, uid, "🖋 <b>امضای ثابت پایین هر پست</b> را بفرستید (مثلاً آیدی و معرفی کانال خودتان). دقیقاً همان‌طور که بنویسید زیر هر پست گذاشته می‌شود.\nبدون امضا: <code>-</code>"));
    }
    case "ag_footer": {
      d.footer = text === "-" ? "" : text.slice(0, 500);
      await tg.send(env, uid, "🔎 در حال تحلیل دستور…");
      let plan: Plan | null = null, why = "پاسخ قابل‌فهمی نگرفتم";
      try { plan = await planJob(env, String(d.instruction)); } catch (e) { why = (e as Error).message; }
      if (!plan) { await setSession(env, uid, "ag_footer", d); return void (await tg.send(env, uid, `❌ ${esc(why)}.\nمشکل که برطرف شد، دوباره امضا را (یا <code>-</code>) بفرستید تا تلاش کنم. لغو: /cancel`)); }
      d.plan = plan;
      if (!plan.times.length && !plan.onceAt) { await setSession(env, uid, "ag_when", d); return void (await tg.send(env, uid, "در دستورتان ساعتی پیدا نکردم.\n" + WHEN_HELP)); }
      return confirm(env, uid, d);
    }
    case "ag_when": {
      const t = parseTimes(text);
      if (!t) return void (await tg.send(env, uid, "❌ ساعت نامعتبر است.\n" + WHEN_HELP));
      if (t === "now") d.plan.onceAt = now() + 60; else { d.plan.times = t; d.plan.onceAt = null; }
      return confirm(env, uid, d);
    }
    case "ag_e_instr": case "ag_e_footer": case "ag_e_times": {
      const j = await getJob(env, d.job_id);
      if (!j || j.user_id !== uid) return void (await clearSession(env, uid));
      if (state === "ag_e_instr") {
        if (text.length < 10 || text.length > 2000) return void (await tg.send(env, uid, "دستور باید بین ۱۰ تا ۲۰۰۰ نویسه باشد."));
        await env.DB.prepare("UPDATE agent_jobs SET instruction=? WHERE id=?").bind(text, j.id).run();
      } else if (state === "ag_e_footer") {
        await env.DB.prepare("UPDATE agent_jobs SET footer=? WHERE id=?").bind(text === "-" ? "" : text.slice(0, 500), j.id).run();
      } else {
        const t = parseTimes(text);
        if (!t) return void (await tg.send(env, uid, "❌ ساعت نامعتبر است.\n" + WHEN_HELP));
        if (t === "now") await env.DB.prepare("UPDATE agent_jobs SET once_at=?, times='[]', days=NULL, last_key='', enabled=1 WHERE id=?").bind(now() + 60, j.id).run();
        else await env.DB.prepare("UPDATE agent_jobs SET times=?, days=NULL, once_at=NULL, last_key=?, attempts=0, retry_at=NULL WHERE id=?").bind(JSON.stringify(t), slotKey(now()), j.id).run();
      }
      await clearSession(env, uid);
      return show(env, uid, (await getJob(env, j.id))!);
    }
  }
}

// ------------------------------------------------------------------ callbacks
export async function onCallback(c: Ctx, user: UserRow, admin: boolean, q: TgCallback, act: string, arg: string, s: { state: string; data: Record<string, any> }): Promise<void> {
  const { env } = c, uid = user.id, mid = q.message?.message_id;
  const ans = (t = "", alert = false) => tg.answer(env, q.id, t, alert);
  if (!(await llmReady(env))) return ans("ایجنت هنوز فعال نشده است.", true);

  if (act === "new") {
    await ans();
    const list = await userChannels(env, uid);
    if (!user.eitaa_token_enc) return void (await tg.send(env, uid, "ابتدا از «برنامه‌های متصل» توکن ایتایار را ثبت کنید."));
    if (!list.length) return void (await tg.send(env, uid, "ابتدا از «کانال‌ها» کانال خودتان را اضافه کنید."));
    if ((await userJobs(env, uid)).length >= MAX_JOBS) return void (await tg.send(env, uid, `حداکثر ${MAX_JOBS} ایجنت مجاز است.`));
    if (list.length === 1) return askInstruction(env, uid, { channel_id: list[0].id });
    return void (await tg.send(env, uid, "ایجنت در کدام کانال شما پست بگذارد؟", ikb(list.map((ch) => [[`🟠 ${ch.title}`.slice(0, 40), `ag:nc:${ch.id}`] as Btn]))));
  }
  if (act === "nc") {
    await ans();
    const ch = await getChannel(env, Number(arg));
    return ch && ch.user_id === uid ? askInstruction(env, uid, { channel_id: ch.id }) : undefined;
  }
  if (act === "x") { await clearSession(env, uid); await ans("لغو شد."); return void (mid && (await tg.edit(env, uid, mid, "لغو شد."))); }
  if (act === "redo") { await ans(); return askInstruction(env, uid, { channel_id: s.data.channel_id }); }
  if (act === "mk") {
    if (s.state !== "ag_confirm" || !s.data.plan) return ans("این پیش‌نویس منقضی شده؛ دوباره «ایجنت جدید» بزنید.", true);
    if ((await userJobs(env, uid)).length >= MAX_JOBS) return ans(`حداکثر ${MAX_JOBS} ایجنت مجاز است.`, true);
    const j = await createJob(env, uid, s.data);
    await clearSession(env, uid);
    await ans("ساخته شد ✅");
    if (mid) await tg.edit(env, uid, mid, "✅ ایجنت ساخته شد.");
    return show(env, uid, j);
  }

  // draft approval buttons carry a post id, everything else a job id
  if (act === "go" || act === "no") {
    const pid = Number(arg);
    const r = act === "go"
      ? await env.DB.prepare("UPDATE ea_posts SET status='pending', run_at=? WHERE id=? AND user_id=? AND status='draft'").bind(now(), pid, uid).run()
      : await env.DB.prepare("UPDATE ea_posts SET status='canceled' WHERE id=? AND user_id=? AND status='draft'").bind(pid, uid).run();
    await ans(r.meta.changes ? (act === "go" ? "در صف انتشار قرار گرفت." : "حذف شد.") : "قابل تغییر نیست.");
    if (mid && r.meta.changes) await tg.edit(env, uid, mid, act === "go" ? `🚀 پست #${pid} در صف انتشار است…` : `🗑 پیش‌نویس #${pid} حذف شد.`);
    return;
  }

  const j = await getJob(env, Number(arg));
  if (!j || j.user_id !== uid) return ans();
  switch (act) {
    case "v": await ans(); return show(env, uid, j);
    case "run":
      await env.DB.prepare("UPDATE agent_jobs SET run_now=1 WHERE id=?").bind(j.id).run();
      await ans("در صف اجرا قرار گرفت.");
      return void (await tg.send(env, uid, "▶️ ایجنت تا حداکثر یک دقیقه‌ی دیگر اجرا می‌شود و نتیجه را همین‌جا می‌فرستد."));
    case "tg":
      await env.DB.prepare("UPDATE agent_jobs SET enabled=?, last_key=?, retry_at=NULL, attempts=0 WHERE id=?").bind(j.enabled ? 0 : 1, j.once_at ? j.last_key : slotKey(now()), j.id).run();
      await ans(j.enabled ? "متوقف شد." : "فعال شد.");
      return show(env, uid, (await getJob(env, j.id))!, mid);
    case "ap":
      await env.DB.prepare("UPDATE agent_jobs SET approve=? WHERE id=?").bind(j.approve ? 0 : 1, j.id).run();
      await ans();
      return show(env, uid, (await getJob(env, j.id))!, mid);
    case "ed": await ans(); await setSession(env, uid, "ag_e_instr", { job_id: j.id }); return void (await tg.send(env, uid, "✏️ دستور جدید را بفرستید (جایگزین دستور فعلی می‌شود). لغو: /cancel"));
    case "ft": await ans(); await setSession(env, uid, "ag_e_footer", { job_id: j.id }); return void (await tg.send(env, uid, "🖋 امضای جدید را بفرستید. حذف امضا: <code>-</code>"));
    case "tm": await ans(); await setSession(env, uid, "ag_e_times", { job_id: j.id }); return void (await tg.send(env, uid, WHEN_HELP));
    case "del": await ans(); return void (await tg.send(env, uid, `ایجنت «${esc(j.name)}» حذف شود؟`, ikb([[["✅ بله، حذف", `ag:dy:${j.id}`], ["خیر", `ag:v:${j.id}`]]])));
    case "dy":
      await env.DB.batch([
        env.DB.prepare("UPDATE ea_posts SET status='canceled' WHERE job_id=? AND status IN ('pending','draft')").bind(j.id),
        env.DB.prepare("DELETE FROM agent_seen WHERE job_id=?").bind(j.id),
        env.DB.prepare("DELETE FROM agent_jobs WHERE id=?").bind(j.id),
      ]);
      await ans("حذف شد.");
      return void (mid && (await tg.edit(env, uid, mid, "🗑 ایجنت حذف شد.")));
  }
}
