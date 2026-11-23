import { useEffect, useRef } from "react";

/** Browser lockdown + focus-loss monitoring. `report` receives event types the server understands. */
export function useLockdown(active: boolean, report: (type: string, detail?: any) => void) {
  const rep = useRef(report);
  rep.current = report;

  useEffect(() => {
    if (!active) return;
    document.body.classList.add("exam-lock");
    const last: Record<string, number> = {};
    const throttled = (t: string, d?: any) => {
      const n = Date.now();
      if ((last[t] || 0) + 5000 > n) return;
      last[t] = n;
      rep.current(t, d);
    };
    const block = (type: string) => (e: Event) => { e.preventDefault(); throttled(type); };
    const quiet = (e: Event) => e.preventDefault();
    const doc: [string, any][] = [
      ["contextmenu", block("CONTEXT_MENU")], ["copy", block("COPY_ATTEMPT")], ["cut", block("CUT_ATTEMPT")],
      ["paste", block("PASTE_ATTEMPT")], ["selectstart", quiet], ["dragstart", quiet],
    ];
    doc.forEach(([k, f]) => document.addEventListener(k, f));

    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
      const devtools = e.key === "F12" || (mod && e.shiftKey && ["i", "j", "c"].includes(k)) || (e.metaKey && e.altKey && ["i", "j", "u", "c"].includes(k)) || (mod && k === "u");
      const clip = mod && ["c", "v", "x", "a", "s", "p"].includes(k);
      if (devtools) { e.preventDefault(); throttled("DEVTOOLS_KEY", { key: e.key }); }
      else if (clip) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === "PrintScreen") navigator.clipboard?.writeText("").catch(() => {}); };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);

    // One strike per focus-loss episode (blur and visibilitychange fire together; server also dedupes within 2s).
    let lost = false;
    const lose = (source: string) => { if (lost) return; lost = true; rep.current("TAB_SWITCH", { source }); };
    const regain = () => { if (document.visibilityState === "visible" && document.hasFocus()) lost = false; };
    const onVis = () => (document.hidden ? lose("visibility") : regain());
    const onBlur = () => lose("blur");
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", regain);

    const onFs = () => { if (!document.fullscreenElement) throttled("FULLSCREEN_EXIT"); };
    document.addEventListener("fullscreenchange", onFs);

    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onUnload);

    const onOffline = () => rep.current("OFFLINE"), onOnline = () => rep.current("ONLINE");
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);

    return () => {
      document.body.classList.remove("exam-lock");
      doc.forEach(([k, f]) => document.removeEventListener(k, f));
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", regain);
      document.removeEventListener("fullscreenchange", onFs);
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [active]);
}
