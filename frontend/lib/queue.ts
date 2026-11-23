// Offline answer queue: AES-GCM encrypted in localStorage, key derived from the session token,
// so a candidate cannot read or edit pending answers by hand.
const K = "exam_q";
const enc = new TextEncoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...Array.from(u)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function key(token: string) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode("q:" + token));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function saveQueue(token: string, items: any[]) {
  try {
    if (!items.length) return localStorage.removeItem(K);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(token), enc.encode(JSON.stringify(items)));
    localStorage.setItem(K, b64(iv) + "." + b64(new Uint8Array(ct)));
  } catch {}
}
export async function loadQueue(token: string): Promise<any[]> {
  try {
    const v = localStorage.getItem(K);
    if (!v) return [];
    const [iv, ct] = v.split(".");
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await key(token), unb64(ct));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch { return []; }
}
export const clearQueue = () => localStorage.removeItem(K);
