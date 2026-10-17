import { dec, enc } from "./crypto";
import { Env } from "./env";

export interface UserRow {
  id: number; name: string; username: string; eitaa_token_enc: string; eitaa_account: string;
  expires_at: number | null; banned: number; created_at: number;
}
export interface ChannelRow { id: number; user_id: number; chat_id: string; title: string; platform: string }
export interface PostRow {
  id: number; user_id: number; channel_id: number; kind: string; text: string; file_id: string; file_name: string; title: string;
  silent: number; pin: number; view_delete: number; run_at: number; status: string; error: string; src_url: string; job_id: number | null;
}
export interface JobRow {
  id: number; user_id: number; channel_id: number; name: string; instruction: string; times: string; days: string | null; once_at: number | null;
  footer: string; approve: number; enabled: number; run_now: number; last_key: string; retry_at: number | null; attempts: number; last_info: string; created_at: number;
}
export const now = (): number => Math.floor(Date.now() / 1000);

export async function getSession(env: Env, uid: number): Promise<{ state: string; data: Record<string, any> }> {
  const r = await env.DB.prepare("SELECT state, data FROM ea_sessions WHERE user_id=?").bind(uid).first<{ state: string; data: string }>();
  if (!r) return { state: "", data: {} };
  try { return { state: r.state, data: JSON.parse(r.data) }; } catch { return { state: r.state, data: {} }; }
}
export async function setSession(env: Env, uid: number, state: string, data: Record<string, any> = {}): Promise<void> {
  await env.DB.prepare("INSERT INTO ea_sessions(user_id,state,data,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET state=excluded.state,data=excluded.data,updated_at=excluded.updated_at")
    .bind(uid, state, JSON.stringify(data), now()).run();
}
export const clearSession = (env: Env, uid: number) => setSession(env, uid, "", {});

export async function touchUser(env: Env, id: number, name: string, username: string): Promise<UserRow> {
  await env.DB.prepare("INSERT INTO ea_users(id,name,username,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, username=excluded.username")
    .bind(id, name.slice(0, 100), (username || "").slice(0, 64), now()).run();
  return (await env.DB.prepare("SELECT * FROM ea_users WHERE id=?").bind(id).first<UserRow>())!;
}
export const getUser = (env: Env, id: number) => env.DB.prepare("SELECT * FROM ea_users WHERE id=?").bind(id).first<UserRow>();
export const getChannel = (env: Env, id: number) => env.DB.prepare("SELECT * FROM ea_channels WHERE id=?").bind(id).first<ChannelRow>();
export const userChannels = async (env: Env, uid: number) =>
  (await env.DB.prepare("SELECT * FROM ea_channels WHERE user_id=? ORDER BY id").bind(uid).all<ChannelRow>()).results;

export const getJob = (env: Env, id: number) => env.DB.prepare("SELECT * FROM agent_jobs WHERE id=?").bind(id).first<JobRow>();
export const userJobs = async (env: Env, uid: number) => (await env.DB.prepare("SELECT * FROM agent_jobs WHERE user_id=? ORDER BY id").bind(uid).all<JobRow>()).results;
