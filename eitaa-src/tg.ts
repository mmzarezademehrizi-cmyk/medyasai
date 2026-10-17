import { Env, tgBase } from "./env";

export interface TgUser { id: number; first_name?: string; username?: string }
export interface TgMessage {
  message_id: number; from?: TgUser; chat: { id: number; type: string }; text?: string; caption?: string;
  photo?: { file_id: string; file_unique_id: string; file_size?: number }[];
  video?: { file_id: string; file_unique_id: string; file_name?: string; file_size?: number };
  document?: { file_id: string; file_unique_id: string; file_name?: string; file_size?: number };
  audio?: { file_id: string; file_unique_id: string; file_name?: string; file_size?: number };
  voice?: { file_id: string; file_unique_id: string; file_size?: number };
  animation?: { file_id: string; file_unique_id: string; file_name?: string; file_size?: number };
  sticker?: { file_id: string; file_unique_id: string; file_size?: number; is_animated?: boolean; is_video?: boolean };
}
export interface TgCallback { id: string; from: TgUser; message?: TgMessage; data?: string }
export interface TgUpdate { update_id: number; message?: TgMessage; callback_query?: TgCallback }

export type Btn = [string, string];            // [text, callback_data]
export type Kb = { inline_keyboard: { text: string; callback_data: string }[][] };
export const ikb = (rows: Btn[][]): Kb => ({ inline_keyboard: rows.map((r) => r.map(([text, callback_data]) => ({ text, callback_data }))) });

export class TgError extends Error {}

export async function tg<T = any>(env: Env, method: string, body: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`${tgBase(env)}/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!j.ok) throw new TgError(String(j.description || `HTTP ${r.status}`).replace(env.BOT_TOKEN, "***"));
  return j.result as T;
}

/** Fire-and-forget style helpers that never throw into the handler flow. */
export async function send(env: Env, chat: number, text: string, kb?: Kb | { keyboard: unknown; resize_keyboard: boolean }): Promise<number | null> {
  try {
    const m = await tg<{ message_id: number }>(env, "sendMessage", { chat_id: chat, text: text.slice(0, 4000), parse_mode: "HTML", reply_markup: kb, disable_web_page_preview: true });
    return m.message_id;
  } catch { return null; }
}
export async function edit(env: Env, chat: number, mid: number, text: string, kb?: Kb): Promise<void> {
  try { await tg(env, "editMessageText", { chat_id: chat, message_id: mid, text: text.slice(0, 4000), parse_mode: "HTML", reply_markup: kb }); } catch { /* not modified / too old */ }
}
export async function answer(env: Env, id: string, text = "", alert = false): Promise<void> {
  try { await tg(env, "answerCallbackQuery", { callback_query_id: id, text, show_alert: alert }); } catch { /* expired */ }
}
export async function del(env: Env, chat: number, mid: number): Promise<void> {
  try { await tg(env, "deleteMessage", { chat_id: chat, message_id: mid }); } catch { /* ignore */ }
}

/** Download a Telegram file (bot API limit 20 MB). */
export async function download(env: Env, fileId: string): Promise<Uint8Array> {
  const f = await tg<{ file_path?: string }>(env, "getFile", { file_id: fileId });
  if (!f.file_path) throw new TgError("فایل در تلگرام پیدا نشد");
  const r = await fetch(`${tgBase(env)}/file/bot${env.BOT_TOKEN}/${f.file_path}`);
  if (!r.ok) throw new TgError(`دانلود فایل از تلگرام ناموفق بود (HTTP ${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}

export async function typing(env: Env, chat: number): Promise<void> {
  try { await tg(env, "sendChatAction", { chat_id: chat, action: "typing" }); } catch { /* ignore */ }
}
