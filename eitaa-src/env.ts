export interface Env {
  DB: D1Database;
  AI?: { run(model: string, input: Record<string, unknown>): Promise<any> };   // Workers AI binding: free, no API key needed
  BOT_TOKEN: string;
  SECRET_KEY: string;
  WEBHOOK_SECRET: string;
  ADMIN_IDS?: string;
  TG_API_BASE?: string;     // default https://api.telegram.org
  EITAA_API_BASE?: string;  // default https://eitaayar.ir/api  (point at your own relay if eitaayar blocks Cloudflare IPs)
  EITAA_WEB_BASE?: string;  // default https://eitaa.com
  EA_ACCESS?: boolean;       // set by the host bot: owner or paid plan
  EA_MODEL?: string;         // preferred Workers AI model (host bot MODEL)
  LLM_TEST_BASE?: string;    // automated tests only
  LLM_TEST_KEY?: string;
}
export const tgBase = (e: Env) => (e.TG_API_BASE || "https://api.telegram.org").replace(/\/$/, "");
export const eitaaBase = (e: Env) => (e.EITAA_API_BASE || "https://eitaayar.ir/api").replace(/\/$/, "");
export const eitaaWeb = (e: Env) => (e.EITAA_WEB_BASE || "https://eitaa.com").replace(/\/$/, "");
export const adminIds = (e: Env): number[] => (e.ADMIN_IDS || "").split(/[,\s]+/).filter((x) => /^\d+$/.test(x)).map(Number);
