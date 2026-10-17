import { b64, unb64 } from "./util";

async function key(secret: string): Promise<CryptoKey> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", h, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function enc(secret: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secret), new TextEncoder().encode(plain)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return b64(out);
}
export async function dec(secret: string, blob: string): Promise<string> {
  if (!blob) return "";
  try {
    const raw = unb64(blob);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await key(secret), raw.slice(12));
    return new TextDecoder().decode(pt);
  } catch {
    return "";  // wrong SECRET_KEY or corrupted: the user simply has to re-enter the token
  }
}
