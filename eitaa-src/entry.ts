// Entry points used by the AI bot (src/index.js). Eitaa features live here: channels, scheduled posts, agents, live chat.
import { handleUpdate } from "./bot";
import { Env } from "./env";
import { tick } from "./scheduler";
import { TgUpdate } from "./tg";
import { SCHEMA } from "./schema";

export { SCHEMA };
export type HostEnv = Record<string, any>;

/** Adapter: the AI bot's env (TELEGRAM_TOKEN, OWNER_ID, WEBHOOK_SECRET…) -> this module's env. */
export function adapt(host: HostEnv, access: boolean): Env {
  return {
    ...host,
    BOT_TOKEN: host.TELEGRAM_TOKEN,
    SECRET_KEY: host.EITAA_SECRET_KEY || `ea:${host.WEBHOOK_SECRET || host.TELEGRAM_TOKEN}`,
    WEBHOOK_SECRET: host.WEBHOOK_SECRET || "",
    ADMIN_IDS: String(host.OWNER_ID || ""),
    EA_ACCESS: access,
    EA_MODEL: host.MODEL || "@cf/google/gemma-4-26b-a4b-it",
  } as Env;
}

export async function ensureSchema(host: HostEnv): Promise<void> {
  await host.DB.batch(SCHEMA.map((s) => host.DB.prepare(s)));
}

export async function handle(host: HostEnv, access: boolean, update: TgUpdate, wait: (p: Promise<unknown>) => void): Promise<void> {
  await handleUpdate({ env: adapt(host, access), wait }, update);
}

export async function cron(host: HostEnv): Promise<void> {
  await tick(adapt(host, true));
}
