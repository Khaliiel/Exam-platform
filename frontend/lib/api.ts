export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";
export const ORG = process.env.NEXT_PUBLIC_ORG_NAME || "Recruitment Office";

export class ApiError extends Error {
  status: number;
  constructor(status: number, detail: string) { super(detail); this.status = status; }
}
export class NetworkError extends Error {}

export async function request(path: string, opts: any = {}): Promise<any> {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.body && !(opts.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
  let res: Response;
  try {
    res = await fetch(API + path, { ...opts, headers, body: opts.body && !(opts.body instanceof FormData) && typeof opts.body !== "string" ? JSON.stringify(opts.body) : opts.body });
  } catch { throw new NetworkError("network"); }
  if (!res.ok) {
    let d = "Something went wrong. Please try again.";
    try { const j = await res.json(); d = typeof j.detail === "string" ? j.detail : "Please check your input."; } catch {}
    if (res.status === 429) d = "Too many attempts. Wait a minute and try again.";
    throw new ApiError(res.status, d);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("json") ? res.json() : res;
}

export const session = {
  get: () => (typeof window === "undefined" ? null : localStorage.getItem("exam_session")),
  set: (t: string) => localStorage.setItem("exam_session", t),
  clear: () => localStorage.removeItem("exam_session"),
};
export const pre = {
  get: () => (typeof window === "undefined" ? null : sessionStorage.getItem("exam_pre")),
  set: (t: string) => sessionStorage.setItem("exam_pre", t),
  clear: () => sessionStorage.removeItem("exam_pre"),
};

export const api = {
  login: (exam_id: string, sessionToken?: string | null) =>
    request("/auth/login", { method: "POST", body: { exam_id }, headers: sessionToken ? { "X-Session-Token": sessionToken } : {} }),
  begin: (preToken: string, body: any) => request("/exam/begin", { method: "POST", body, token: preToken }),
  state: (t: string) => request("/exam/state", { token: t }),
  answers: (t: string, answers: any[]) => request("/exam/answers", { method: "POST", body: { answers }, token: t }),
  startSection: (t: string) => request("/exam/start-section", { method: "POST", token: t }),
  submitSection: (t: string) => request("/exam/submit-section", { method: "POST", token: t }),
  event: (t: string, type: string, detail?: any) => request("/exam/event", { method: "POST", body: { type, detail }, token: t }),
  presign: (t: string, trigger: string) => request("/exam/snapshot/presign", { method: "POST", body: { trigger }, token: t }),
  direct: (t: string, fd: FormData) => request("/exam/snapshot/direct", { method: "POST", body: fd, token: t }),
};
