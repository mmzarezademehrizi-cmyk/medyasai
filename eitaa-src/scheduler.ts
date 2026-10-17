// Delivery of posts: called right away for "send now" and from the cron tick for scheduled ones.
import { agentTick } from "./agent";
import { dec } from "./crypto";
import { ChannelRow, PostRow, UserRow, now } from "./db";
import * as eitaa from "./eitaa";
import { Env, eitaaWeb } from "./env";
import { extFor, fetchBytes } from "./source";
import * as tg from "./tg";
import { esc, fmtDt } from "./util";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_IMG = 15 * 1024 * 1024;

/** Posts made by the agent carry `src_url` (an image on the source channel's CDN); the rest come from Telegram files. */
async function fileBytes(env: Env, p: PostRow): Promise<{ bytes: Uint8Array; name: string }> {
  if (p.src_url) {
    const f = await fetchBytes(p.src_url, MAX_IMG, eitaaWeb(env) + "/");
    return { bytes: f.bytes, name: p.file_name || `image.${extFor(f.type, p.src_url)}` };
  }
  return { bytes: await tg.download(env, p.file_id), name: p.file_name || "file" };
}

async function sendOnce(env: Env, token: string, p: PostRow, ch: ChannelRow): Promise<string> {
  const o: eitaa.PostOpts = { title: p.title || undefined, silent: !!p.silent, pin: !!p.pin, viewDelete: p.view_delete || undefined };
  let res: any;
  if (p.kind === "text") res = await eitaa.sendMessage(env, token, ch.chat_id, p.text, o);
  else { const f = await fileBytes(env, p); res = await eitaa.sendFile(env, token, ch.chat_id, f.name, f.bytes, p.text, o); }
  const id = res && (res.message_id ?? res.id ?? res.result?.message_id);
  return id ? String(id) : "";
}

/** Claims the post (pending -> sending) so two ticks can never send the same post twice, then sends with retries. */
/** `quiet` = the caller (live chat) reports the outcome itself, so no Telegram notices are sent. */
export async function deliver(env: Env, postId: number, quiet = false): Promise<void> {
  const claim = await env.DB.prepare("UPDATE ea_posts SET status='sending', claimed_at=? WHERE id=? AND status='pending'").bind(now(), postId).run();
  if (!claim.meta.changes) return;
  const p = (await env.DB.prepare("SELECT * FROM ea_posts WHERE id=?").bind(postId).first<PostRow>())!;
  const user = await env.DB.prepare("SELECT * FROM ea_users WHERE id=?").bind(p.user_id).first<UserRow>();
  const ch = await env.DB.prepare("SELECT * FROM ea_channels WHERE id=?").bind(p.channel_id).first<ChannelRow>();
  const fail = async (msg: string) => {
    await env.DB.prepare("UPDATE ea_posts SET status='failed', error=? WHERE id=?").bind(msg.slice(0, 300), p.id).run();
    if (!quiet) await tg.send(env, p.user_id, `❌ ارسال پست #${p.id} ناموفق بود:\n${esc(msg)}`);
  };
  if (!user || !ch) return fail("کاربر یا کانال دیگر وجود ندارد.");
  const token = await dec(env.SECRET_KEY, user.eitaa_token_enc);
  if (!token) return fail("توکن ایتایار ثبت نشده یا نامعتبر است. آن را دوباره در «برنامه‌های متصل» ثبت کنید.");
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const mid = await sendOnce(env, token, p, ch);
      await env.DB.prepare("UPDATE ea_posts SET status='sent', sent_at=?, eitaa_message_id=?, error='' WHERE id=?").bind(now(), mid, p.id).run();
      if (!quiet) await tg.send(env, p.user_id, `✅ پست #${p.id} در 🟠 «${esc(ch.title)}» ارسال شد.`);
      return;
    } catch (e) {
      last = (e as Error).message;
      if (!(e instanceof eitaa.EitaaNetworkError) || attempt === 2) break;
      await sleep(2000 * (attempt + 1));
    }
  }
  await fail(last || "خطای نامشخص");
}

/** Cron tick (every minute). Small batches keep each invocation inside the free-plan limits. */
export async function tick(env: Env): Promise<void> {
  const t = now();
  await env.DB.prepare("UPDATE ea_posts SET status='failed', error='ارسال نیمه‌کاره ماند؛ لطفاً دوباره زمان‌بندی کنید.' WHERE status='sending' AND claimed_at < ?").bind(t - 900).run();
  const due = (await env.DB.prepare("SELECT id FROM ea_posts WHERE status='pending' AND run_at<=? ORDER BY run_at LIMIT 3").bind(t).all<{ id: number }>()).results;
  for (const d of due) {
    try { await deliver(env, d.id); } catch (e) { console.error("deliver failed", d.id, (e as Error).message); }
  }
  try { await agentTick(env); } catch (e) { console.error("agent tick failed", (e as Error).message); }
}

export const describe = (p: PostRow) => `#${p.id} · ${fmtDt(p.run_at)}`;
