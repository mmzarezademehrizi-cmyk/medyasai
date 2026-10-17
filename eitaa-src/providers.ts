// The agent's brain runs on Cloudflare Workers AI through the Worker's own binding (wrangler.jsonc: "ai": {"binding": "AI"}).
// No API key, no external service, no setup in the bot. Several models are tried in order: if the big one hits its daily quota,
// the smaller (cheaper) one takes over, so the agent keeps working.
import { Env } from "./env";

export interface LlmCfg { id: string; name: string; model: string; base?: string; key?: string; json: boolean }

// Order = quality first. Names follow the Cloudflare Workers AI catalogue (verify with the "test" in the admin panel).
export const MODELS: { model: string; name: string }[] = [
  { model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", name: "Llama 3.3 70B" },
  { model: "@cf/mistralai/mistral-small-3.1-24b-instruct", name: "Mistral Small 3.1" },
  { model: "@cf/meta/llama-3.1-8b-instruct", name: "Llama 3.1 8B" },
];

let AI: Env["AI"];
export const getAi = () => AI;

const envOf = (env: Env, name: string): string => ((env as unknown as Record<string, string | undefined>)[name] || "").trim();

let cache: { at: number; map: Map<string, string> } | null = null;
async function cools(env: Env): Promise<Map<string, string>> {
  if (cache && Date.now() - cache.at < 15_000) return cache.map;
  const rows = (await env.DB.prepare("SELECT key, value FROM settings WHERE key LIKE 'ea_cool:%'").all<{ key: string; value: string }>()).results;
  cache = { at: Date.now(), map: new Map(rows.map((r) => [r.key, r.value])) };
  return cache.map;
}

/** Models usable right now (cooling ones last). A test-only HTTP endpoint (LLM_TEST_BASE) replaces them in automated tests. */
export async function llmChain(env: Env): Promise<LlmCfg[]> {
  AI = env.AI;
  if (envOf(env, "LLM_TEST_BASE")) return [{ id: "test", name: "test", model: "test-model", base: envOf(env, "LLM_TEST_BASE"), key: envOf(env, "LLM_TEST_KEY"), json: true }];
  if (!env.AI) return [];
  const extra = env.EA_MODEL ? [{ model: env.EA_MODEL, name: "AI" }] : [];
  const m = await cools(env), t = Math.floor(Date.now() / 1000);
  const cool = (id: string) => parseInt(m.get(`ea_cool:${id}`) || "0", 10) > t;
  return [...extra, ...MODELS.filter((x) => x.model !== env.EA_MODEL)].map((x) => ({ id: x.model, name: x.name, model: x.model, json: false })).sort((a, b) => Number(cool(a.id)) - Number(cool(b.id)));
}
export const llmReady = async (env: Env): Promise<boolean> => (await llmChain(env)).length > 0;

export async function markCooldown(env: Env, id: string, seconds: number): Promise<void> {
  await env.DB.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(`ea_cool:${id}`, String(Math.floor(Date.now() / 1000) + seconds)).run();
  cache = null;
}
