// Reading PUBLIC Eitaa channels through their web preview page, plus text cleaning (removing the source channel's signature).
// The parser is deliberately tolerant: it understands the Telegram-widget style markup (`*_widget_message_*` classes and
// `data-post="channel/ID"`) that web previews of this family use. Use the bot's "🔬 تست منبع" button to verify a source.
import { Env, eitaaWeb } from "./env";
import { normDigits } from "./util";

export interface SrcMsg { source: string; id: string; text: string; ts: number | null; image: string; video: boolean; sticker: boolean }
export interface FetchResult { ok: boolean; status: number; messages: SrcMsg[]; title: string; note: string; snippet: string }

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", hellip: "…", zwnj: "‌" };
export const unescapeHtml = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return m; } }
    return ENT[e.toLowerCase()] ?? m;
  });

export function htmlToText(html: string): string {
  const t = unescapeHtml(html
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li)>/gi, "\n").replace(/<[^>]+>/g, ""))
    .replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Loose normalisation for matching: Arabic letters -> Persian, digits -> latin, no diacritics/ZWNJ, lower case. */
export const norm = (s: string): string =>
  normDigits(s).replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/[ً-ٟـ‌‏‎]/g, "").toLowerCase();

export function parseMessages(html: string, source: string, base: string): SrcMsg[] {
  const marks: { at: number; id: string }[] = [];
  const re = /data-post=["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) marks.push({ at: m.index, id: m[1] });
  const out: SrcMsg[] = [];
  const abs = (u: string) => { try { return new URL(unescapeHtml(u), base + "/").toString(); } catch { return ""; } };
  for (let i = 0; i < marks.length; i++) {
    const block = html.slice(marks[i].at, i + 1 < marks.length ? marks[i + 1].at : html.length);
    if (/service_message/.test(block.slice(0, 400))) continue;
    const id = marks[i].id.split("/").pop() || "";
    if (!/^\d+$/.test(id)) continue;
    let text = "";
    const tre = /<div[^>]+class=["']([^"']*_widget_message_text[^"']*)["'][^>]*>([\s\S]*?)<\/div>/gi;
    let tm: RegExpExecArray | null;
    while ((tm = tre.exec(block))) if (!/reply/.test(tm[1])) text = htmlToText(tm[2]);
    const dt = block.match(/<time[^>]+datetime=["']([^"']+)["']/i);
    const ts = dt && !isNaN(Date.parse(dt[1])) ? Math.floor(Date.parse(dt[1]) / 1000) : null;
    let image = "";
    const pm = block.match(/class=["'][^"']*photo_wrap[^"']*["'][^>]*background-image:\s*url\(\s*['"&quot;]*([^'")]+?)['"&quot;]*\s*\)/i)
      || block.match(/background-image:\s*url\(\s*['"&quot;]*([^'")]+?)['"&quot;]*\s*\)[^>]*class=["'][^"']*photo_wrap/i)
      || block.match(/<img[^>]+class=["'][^"']*photo[^"']*["'][^>]+src=["']([^"']+)["']/i);
    if (pm) image = abs(pm[1]);
    // stickers: the static .webp is in data-webp (or the background image of the *_sticker element)
    let sticker = false;
    if (!image) {
      const wp = block.match(/data-webp=["']([^"']+)["']/i);
      let su = wp ? wp[1] : "";
      if (!su) for (const tag of block.matchAll(/<[^>]+class=["'][^"']*_sticker[^"']*["'][^>]*>/gi)) {
        const bg = tag[0].match(/background-image:\s*url\(\s*['"&quot;]*([^'")]+?)['"&quot;]*\s*\)/i) || tag[0].match(/(?:src|data-src)=["']([^"']+\.webp[^"']*)["']/i);
        if (bg) { su = bg[1]; break; }
      }
      if (su) { image = abs(su); sticker = true; }
    }
    const video = /_widget_message_video|<video[\s>]/i.test(block);
    if (!text && !image) continue;
    out.push({ source, id, text, ts, image, video, sticker });
  }
  return out;
}

export function pageTitle(html: string): string {
  const mt = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i) || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return mt ? unescapeHtml(mt[1]).replace(/\s[-–|]\s*(?:Eitaa|ایتا)\s*$/i, "").trim().slice(0, 100) : "";
}

async function getPage(url: string): Promise<{ status: number; html: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  try {
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; MedyasBot/1.0)", "accept-language": "fa,en;q=0.8" }, redirect: "follow", signal: ctl.signal });
    return { status: r.status, html: r.status === 200 ? (await r.text()).slice(0, 600_000) : "" };
  } finally { clearTimeout(timer); }
}

export async function fetchChannel(env: Env, source: string): Promise<FetchResult> {
  const base = eitaaWeb(env), name = source.replace(/^@/, "");
  let last: FetchResult = { ok: false, status: 0, messages: [], title: "", note: "", snippet: "" };
  for (const path of [`/${name}`, `/s/${name}`]) {
    try {
      const { status, html } = await getPage(`${base}${path}`);
      if (status === 404) { last = { ...last, status, note: "کانال پیدا نشد (۴۰۴)" }; continue; }
      if (status !== 200) { last = { ...last, status, note: `پاسخ HTTP ${status}` }; continue; }
      const messages = parseMessages(html, name, base);
      last = { ok: messages.length > 0, status, messages, title: pageTitle(html),
        note: messages.length ? "" : "صفحه باز شد ولی پیامی در آن شناسایی نشد (کانال عمومی نیست یا ساختار صفحه فرق دارد)",
        snippet: htmlToText(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")).slice(0, 400) };
      if (messages.length) return last;
    } catch (e) { last = { ...last, note: `خطای شبکه: ${(e as Error).message}` }; }
  }
  return last;
}

/** Download an image (or small file) from a URL with a size cap. */
export async function fetchBytes(url: string, maxBytes: number, referer?: string): Promise<{ bytes: Uint8Array; type: string }> {
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; MedyasBot/1.0)", ...(referer ? { referer } : {}) }, redirect: "follow" });
  if (!r.ok) throw new Error(`دانلود تصویر منبع ناموفق بود (HTTP ${r.status})`);
  const len = parseInt(r.headers.get("content-length") || "0", 10);
  if (len > maxBytes) throw new Error("حجم تصویر منبع زیاد است");
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.length > maxBytes) throw new Error("حجم تصویر منبع زیاد است");
  return { bytes: buf, type: r.headers.get("content-type") || "" };
}
export const extFor = (type: string, url: string): string => {
  const t = type.toLowerCase();
  if (t.includes("png")) return "png"; if (t.includes("webp")) return "webp"; if (t.includes("gif")) return "gif"; if (t.includes("jpeg") || t.includes("jpg")) return "jpg";
  const m = url.split("?")[0].match(/\.(jpe?g|png|webp|gif)$/i);
  return m ? m[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
};

// ------------------------------------------------------------------ cleaning
const PLATFORM_LINK = /(eitaa\.(com|ir)|t\.me|telegram\.(me|org)|ble\.ir|rubika\.ir|instagram\.com|wa\.me|chat\.whatsapp\.com|igap\.net|gap\.im|splus\.ir|sapp\.ir|soroush|youtube\.com|aparat\.com)\b/i;
const PROMO = /(عضو\s*(شوید|شو|بشید)|عضویت|ورود\s*به\s*کانال|لینک\s*کانال|کانال\s*(ما|رسمی)|ما\s*را\s*(در\s*\S+\s*)?دنبال|مارا\s*دنبال|دنبال\s*کنید|\bjoin\b|فالو\s*کنید|ارتباط\s*با\s*(ما|ادمین)|تبلیغات)/i;
const isSigLine = (line: string, title: string): boolean => {
  const bare = line.replace(/[\s\p{P}\p{S}‌‏]+/gu, "");
  if (!bare) return true;                                             // only decoration / emoji / separators
  if (line.length > 90) return false;                                 // a real sentence is never a signature
  if (/@[A-Za-z0-9_.]{3,}/.test(line) || PLATFORM_LINK.test(line)) return true;
  if (PROMO.test(line)) return true;
  const t = norm(title).replace(/[\s\p{P}\p{S}]+/gu, "");
  return !!t && t.length >= 3 && norm(line).replace(/[\s\p{P}\p{S}]+/gu, "").includes(t) && bare.length <= t.length + 12;
};

/** Removes the source channel's handle/link everywhere and its signature block at the end (and a stray handle line at the start). */
export function cleanText(text: string, source: string, title = ""): string {
  let t = text
    .replace(new RegExp(`https?://(?:www\\.)?eitaa\\.com/(?:s/)?${escRe(source)}\\S*`, "gi"), "")
    .replace(new RegExp(`@${escRe(source)}(?![A-Za-z0-9_])`, "gi"), "");
  let lines = t.split("\n").map((l) => l.replace(/[ \t]+$/g, ""));
  while (lines.length && isSigLine(lines[lines.length - 1], title)) lines.pop();
  while (lines.length && lines.length > 1 && isSigLine(lines[0], title) && lines[0].length < 60 && (/@|\/\/|eitaa/i.test(lines[0]) || !lines[0].replace(/[\s\p{P}\p{S}]+/gu, ""))) lines.shift();
  t = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return t;
}
