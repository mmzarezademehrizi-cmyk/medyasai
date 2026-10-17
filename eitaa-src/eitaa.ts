import { Env, eitaaBase, eitaaWeb } from "./env";

export class EitaaError extends Error {}
export class EitaaNetworkError extends EitaaError {}

export interface PostOpts { title?: string; silent?: boolean; pin?: boolean; viewDelete?: number }

// Eitaayar's API path is /api/bot<id>:<uuid>/<method>. Users may paste the token with or
// without the leading "bot"; the base may or may not already end with "/bot".
function eitaaUrl(env: Env, token: string, method: string): string {
  const base = eitaaBase(env).replace(/\/+$/, "").replace(/\/bot$/i, "");
  const t = token.trim().replace(/^bot/i, "");
  return `${base}/bot${t}/${method}`;
}

async function call(env: Env, token: string, method: string, form: FormData): Promise<any> {
  const raw = token.trim().replace(/^bot/i, "");
  const clean = (m: string) => m.split(raw).join("***").split(token).join("***");
  let r: Response;
  try {
    r = await fetch(eitaaUrl(env, token, method), { method: "POST", body: form });
  } catch (e) {
    throw new EitaaNetworkError(clean(`${(e as Error).name}: ${(e as Error).message}`));
  }
  let j: any;
  try { j = await r.json(); } catch { throw new EitaaError(`پاسخ نامعتبر از ایتایار (HTTP ${r.status})`); }
  if (!j || typeof j !== "object" || !j.ok) {
    throw new EitaaError(clean(String((j && (j.description || j.message || j.error)) || `HTTP ${r.status}`)));
  }
  return j.result ?? j;
}

function opts(form: FormData, o: PostOpts) {
  if (o.title) form.set("title", o.title);
  if (o.silent) form.set("disable_notification", "1");
  if (o.pin) form.set("pin", "1");
  if (o.viewDelete) form.set("viewCountForDelete", String(o.viewDelete));
}

export const getMe = (env: Env, token: string) => call(env, token, "getMe", new FormData());

export function sendMessage(env: Env, token: string, chatId: string, text: string, o: PostOpts = {}) {
  const f = new FormData();
  f.set("chat_id", chatId); f.set("text", text); opts(f, o);
  return call(env, token, "sendMessage", f);
}
export function sendFile(env: Env, token: string, chatId: string, name: string, bytes: Uint8Array, caption: string, o: PostOpts = {}) {
  const f = new FormData();
  f.set("chat_id", chatId); if (caption) f.set("caption", caption); opts(f, o);
  f.set("file", new Blob([bytes.slice().buffer as ArrayBuffer]), name);
  // the docs list "sendDocument" in the method index and "sendFile" in the section title: try sendFile, fall back to sendDocument
  return call(env, token, "sendFile", f).catch((e) => {
    if (e instanceof EitaaNetworkError || !/method|not\s*found|unknown|invalid/i.test((e as Error).message)) throw e;
    return call(env, token, "sendDocument", f);
  });
}

// ---- public page lookup (best effort; Eitaayar has no getChat)
const GENERIC = new Set(["", "eitaa", "ایتا", "پیام رسان ایتا", "پیام‌رسان ایتا", "eitaa messenger"]);
const unesc = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
function meta(page: string, prop: string): string {
  for (const re of [new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i"),
                    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, "i")]) {
    const m = page.match(re);
    if (m) return unesc(m[1]).trim();
  }
  return "";
}
export function parseChatPage(page: string, isInvite: boolean) {
  let title = meta(page, "og:title");
  if (!title) { const m = page.match(/<title[^>]*>([\s\S]*?)<\/title>/i); title = m ? unesc(m[1]).trim() : ""; }
  title = title.split(/\s[-–|]\s*(?:Eitaa|ایتا)\s*$/i)[0].trim();
  const desc = meta(page, "og:description") || meta(page, "description");
  if (GENERIC.has(title.toLowerCase())) return { exists: false as boolean | null, kind: "unknown", title: "", desc: "" };
  const text = page.replace(/<[^>]+>/g, " "), low = text.toLowerCase();
  const kind = text.includes("مشترک") || low.includes("subscriber") || low.includes("followers") ? "channel"
    : text.includes("عضو") || low.includes("members") ? "group" : isInvite ? "private" : "unknown";
  return { exists: true as boolean | null, kind, title: title.slice(0, 100), desc: desc.slice(0, 200) };
}
export async function lookupChat(env: Env, chatId: string) {
  const none = { exists: null as boolean | null, kind: "unknown", title: "", desc: "" };
  const cid = chatId.trim(), invite = cid.includes("joinchat");
  let url: string;
  if (invite) url = `${eitaaWeb(env)}/joinchat/${cid.replace(/\/$/, "").split("joinchat/").pop()!.split("?")[0]}`;
  else if (/^[A-Za-z0-9_.]{3,64}$/.test(cid) && !/^\d+$/.test(cid)) url = `${eitaaWeb(env)}/${cid}`;
  else return none;
  try {
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, redirect: "follow" });
    if (r.status === 404) return { ...none, exists: false };
    if (r.status !== 200) return none;
    return parseChatPage(await r.text(), invite);
  } catch { return none; }
}
