import { API, ApiError, request } from "./api";

export const adminToken = {
  get: () => (typeof window === "undefined" ? null : sessionStorage.getItem("admin_token")),
  set: (t: string) => sessionStorage.setItem("admin_token", t),
  clear: () => sessionStorage.removeItem("admin_token"),
};

export async function adm(path: string, opts: any = {}) {
  try {
    return await request("/admin" + path, { ...opts, token: adminToken.get() });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && !path.startsWith("/login")) { adminToken.clear(); window.location.href = "/admin"; }
    throw e;
  }
}

export async function download(path: string, filename: string) {
  const res = await fetch(API + "/admin" + path, { headers: { Authorization: `Bearer ${adminToken.get()}` } });
  if (!res.ok) throw new Error("Download failed");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
