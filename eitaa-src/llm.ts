// OpenAI-compatible chat client used by the agent. It walks the provider chain (active first): if one fails because of quota,
// balance, an invalid key, a rate limit or an outage, the next configured provider is tried automatically.
import { Env } from "./env";
import { LlmCfg, getAi, llmChain, markCooldown } from "./providers";

export interface ToolDef { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }
export interface ChatMsg { role: "system" | "user" | "assistant" | "tool"; content?: string | null; name?: string; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[]; tool_call_id?: string }

/** Readable Persian reason for an LLM HTTP failure (shown to the owner instead of a vague "no answer"). */
export function httpReason(status: number): string {
  if (status === 401 || status === 403) return "کلید API نامعتبر است یا دسترسی ندارد";
  if (status === 402) return "موجودی/اعتبار حساب تمام شده است";
  if (status === 404) return "مدل یا آدرس API پیدا نشد (نام مدل را بررسی کنید)";
  if (status === 429) return "سهمیه یا محدودیت تعداد درخواست پر شده است";
  if (status >= 500) return "سرویس موقتاً در دسترس نیست";
  return `خطای HTTP ${status}`;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Valid, canonical JSON arguments from whatever a model produced (a string, an object, or a string with extra text after the object). */
export function cleanArgs(raw: unknown): string {
  if (raw && typeof raw === "object") return JSON.stringify(raw);
  const s = String(raw ?? "").trim();
  if (!s) return "{}";
  try { const v = JSON.parse(s); return JSON.stringify(v && typeof v === "object" ? v : {}); } catch { /* fall through */ }
  const start = s.indexOf("{");
  if (start >= 0) {                                  // first balanced {...} (strings respected)
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true; else if (ch === "{") depth++; else if (ch === "}" && --depth === 0) { try { return JSON.stringify(JSON.parse(s.slice(start, i + 1))); } catch { break; } }
    }
  }
  return "{}";
}

/** Workers AI through the Worker's own binding (no key). Output is converted to the OpenAI chat-completions shape. */
async function viaBinding(cfg: LlmCfg, body: Record<string, unknown>): Promise<any> {
  const ai = getAi();
  if (!ai) throw new Error("اتصال Workers AI (binding) فعال نیست");
  const all = body.messages as ChatMsg[];
  const nameOf = new Map<string, string>(all.flatMap((m) => (m.tool_calls || []).map((c) => [c.id, c.function.name] as [string, string])));
  const msgs = all.map((m) => m.tool_calls
    ? { role: "assistant", content: m.content || "", tool_calls: m.tool_calls.map((c) => ({ id: c.id, type: "function", function: { name: c.function.name, arguments: cleanArgs(c.function.arguments) } })) }
    : m.role === "tool" ? { role: "tool", tool_call_id: m.tool_call_id, name: nameOf.get(m.tool_call_id || "") || m.name || "tool", content: String(m.content ?? "") }
    : m);
  const run = (tools?: unknown) => ai.run(cfg.model, { messages: msgs, max_tokens: body.max_tokens, temperature: body.temperature, ...(tools ? { tools } : {}) });
  let r: any;
  try {
    try { r = await run(body.tools); }                                                         // OpenAI-style tools (what current models expect)
    catch (e) {
      if (!body.tools || !/tools|function/i.test(String((e as Error).message)) || /8007.*arguments/i.test(String((e as Error).message))) throw e;
      r = await run((body.tools as ToolDef[]).map((t) => t.function));                         // older models want the bare function objects
    }
  } catch (e) {
    const t = String((e as Error).message || e);
    const quota = /limit|quota|neurons|capacity|4006|allocation/i.test(t);
    throw Object.assign(new Error(quota ? httpReason(429) : `Workers AI: ${t.slice(0, 120)}`), quota ? { status: 429 } : /deprecated|5028|not found|no such model/i.test(t) ? { status: 404 } : {});
  }
  if (r?.choices?.[0]?.message) return r;
  const rawCalls = r?.tool_calls || r?.result?.tool_calls || [];
  const calls = rawCalls.map((c: any, i: number) => ({ id: c.id || `cf_${Date.now().toString(36)}_${i}`, type: "function", function: { name: c.name || c.function?.name, arguments: cleanArgs(c.arguments ?? c.function?.arguments) } }));
  const text = r?.response ?? r?.result?.response;
  return { choices: [{ message: { role: "assistant", content: typeof text === "string" ? text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim() : null, ...(calls.length ? { tool_calls: calls } : {}) } }] };
}

export async function callOne(cfg: LlmCfg, body: Record<string, unknown>, timeoutMs = 45_000): Promise<any> {
  if (!cfg.base) return viaBinding(cfg, body);
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(`${cfg.base}/chat/completions`, {
        method: "POST", signal: ctl.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` },
        body: JSON.stringify({ model: cfg.model, ...body }),
      });
      if (!r.ok) {
        console.error("llm http", cfg.id, r.status);
        if ((r.status === 429 || r.status >= 500) && attempt === 0) { await sleep(4000); continue; }
        throw Object.assign(new Error(httpReason(r.status)), { status: r.status });
      }
      const j: any = await r.json();
      if (j?.error) throw new Error(String(j.error.message || "خطای نامشخص از سرویس").slice(0, 160));
      return j;
    } catch (e) {
      if ((e as Error).name === "AbortError") { if (attempt === 0 && timeoutMs >= 30_000) continue; throw new Error("پاسخ نداد (timeout)"); }
      throw e;
    } finally { clearTimeout(timer); }
  }
  throw new Error("پاسخ نداد");
}

async function viaChain<T>(env: Env, fn: (cfg: LlmCfg) => Promise<T>): Promise<T> {
  const chain = await llmChain(env);
  if (!chain.length) throw new Error("هنوز هیچ سرویس هوش مصنوعی تنظیم نشده است");
  const errs: string[] = [];
  for (const cfg of chain) {
    try { return await fn(cfg); } catch (e) {
      errs.push(`${cfg.name}: ${(e as Error).message}`);
      const st = (e as { status?: number }).status;   // quota / balance / key problems: don't hammer this provider again for a while
      if (st === 429) await markCooldown(env, cfg.id, 10 * 60).catch(() => {});
      else if (st === 404) await markCooldown(env, cfg.id, 6 * 3600).catch(() => {});   // retired/renamed model
      else if (st === 402 || st === 401 || st === 403) await markCooldown(env, cfg.id, 30 * 60).catch(() => {});
      else if (st && st >= 500) await markCooldown(env, cfg.id, 2 * 60).catch(() => {});
    }
  }
  throw new Error(errs.join(" | "));
}

/** Asks for a JSON object. Throws an Error with a readable Persian message on failure. */
export function chatJson(env: Env, system: string, user: string, maxTokens = 1500): Promise<any> {
  return viaChain(env, async (cfg) => {
    const j = await callOne(cfg, {
      temperature: 0.2, max_tokens: maxTokens, ...(cfg.json ? { response_format: { type: "json_object" } } : {}),
      messages: [{ role: "system", content: system + "\nReply with a single JSON object and nothing else." }, { role: "user", content: user }],
    });
    const content: string = j?.choices?.[0]?.message?.content || "";
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("پاسخ قابل‌فهم نبود");
    try { return JSON.parse(m[0]); } catch { throw new Error("پاسخ قابل‌فهم نبود"); }
  });
}

/** One step of a tool-calling conversation (OpenAI-compatible function calling). */
export function chatTools(env: Env, messages: ChatMsg[], tools: ToolDef[], timeoutMs = 45_000, maxTokens = 900): Promise<ChatMsg> {
  return viaChain(env, async (cfg) => {
    const msgs = messages;
    const j = await callOne(cfg, { temperature: 0.3, max_tokens: maxTokens, messages: msgs, tools, tool_choice: "auto" }, timeoutMs);
    const m = j?.choices?.[0]?.message;
    if (!m) throw new Error("پاسخ نامعتبر");
    const calls = (m.tool_calls || []).filter((c: any) => (c.function?.name || c.name)).map((c: any, i: number) => ({ id: c.id || `call_${Date.now().toString(36)}_${i}`, type: "function", function: { name: c.function?.name || c.name, arguments: cleanArgs(c.function?.arguments ?? c.arguments) } }));
    return { role: "assistant", content: typeof m.content === "string" ? m.content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim() : null, ...(calls.length ? { tool_calls: calls } : {}) } as ChatMsg;
  });
}
