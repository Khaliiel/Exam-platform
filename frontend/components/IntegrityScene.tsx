"use client";
import { useEffect, useState } from "react";

const MESSAGES = [
  { h: "Integrity comes first", p: "Your result should show your own ability and nothing else." },
  { h: "Malpractice is a serious offence", p: "Using unfair means to pass a job exam can end your application on the spot." },
  { h: "The risk is never worth it", p: "Disqualification and lost trust cost far more than a few wrong answers." },
  { h: "This session is monitored", p: "Camera snapshots and window activity are logged and reviewed by the hiring team." },
  { h: "Do your best, honestly", p: "Honest effort is the strongest foundation for the job you want." },
];

/** Vector animation: a shield draws itself, a tick follows, a balance scale sways beneath it.
 *  Optional upgrade: drop a short video at /public/integrity.mp4 and it plays in place of the drawing. */
export default function IntegrityScene() {
  const [i, setI] = useState(0);
  const [video, setVideo] = useState(false);
  useEffect(() => { const t = setInterval(() => setI((x) => (x + 1) % MESSAGES.length), 5500); return () => clearInterval(t); }, []);
  const m = MESSAGES[i];
  return (
    <div className="text-center">
      <div className="relative mx-auto max-w-[420px]">
        <svg viewBox="0 0 420 290" role="img" aria-label="A shield with a tick above a balanced scale, symbolising integrity" className={video ? "invisible" : "block w-full"}>
          <defs>
            <linearGradient id="sg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#cfeaf0" /></linearGradient>
            <radialGradient id="glow" cx="50%" cy="45%" r="50%"><stop offset="0" stopColor="#5eead4" stopOpacity="0.5" /><stop offset="1" stopColor="#5eead4" stopOpacity="0" /></radialGradient>
          </defs>
          <circle className="breathe" cx="210" cy="125" r="120" fill="url(#glow)" />
          <circle className="ripple" cx="210" cy="125" r="78" fill="none" stroke="#1B365D" strokeOpacity="0.5" strokeWidth="1.5" />
          <circle className="ripple d2" cx="210" cy="125" r="78" fill="none" stroke="#0f766e" strokeOpacity="0.5" strokeWidth="1.5" />
          <path className="shield" pathLength={1} d="M210 44 L282 72 V128 C282 172 248 204 210 220 C172 204 138 172 138 128 V72 Z" fill="url(#sg)" stroke="#1B365D" strokeWidth="3.5" strokeLinejoin="round" />
          <path className="tick" pathLength={1} d="M178 128 L202 152 L246 102" fill="none" stroke="#0f766e" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
          <g className="beam">
            <line x1="148" y1="246" x2="272" y2="246" stroke="#1B365D" strokeWidth="3.5" strokeLinecap="round" />
            <line x1="152" y1="246" x2="138" y2="266" stroke="#1B365D" strokeWidth="1.8" /><line x1="152" y1="246" x2="166" y2="266" stroke="#1B365D" strokeWidth="1.8" />
            <line x1="268" y1="246" x2="254" y2="266" stroke="#1B365D" strokeWidth="1.8" /><line x1="268" y1="246" x2="282" y2="266" stroke="#1B365D" strokeWidth="1.8" />
            <path d="M134 266 Q152 282 170 266 Z" fill="#0f766e" fillOpacity="0.85" /><path d="M250 266 Q268 282 286 266 Z" fill="#1B365D" fillOpacity="0.85" />
          </g>
          <line x1="210" y1="246" x2="210" y2="282" stroke="#1B365D" strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="210" cy="246" r="5" fill="#D97706" />
          <circle className="floaty" cx="120" cy="170" r="3" fill="#0f766e" /><circle className="floaty" style={{ animationDelay: "2.3s" }} cx="305" cy="150" r="3.5" fill="#6366f1" /><circle className="floaty" style={{ animationDelay: "4.4s" }} cx="95" cy="110" r="2.5" fill="#D97706" />
        </svg>
        <video src="/integrity.mp4" autoPlay muted loop playsInline preload="metadata" onCanPlay={() => setVideo(true)} className={video ? "absolute inset-0 h-full w-full rounded-xl object-cover" : "hidden"} />
      </div>
      <div key={i} className="fade-up mt-3 min-h-[5.6rem] px-2" aria-live="polite">
        <h3 className="text-xl text-navy">{m.h}</h3>
        <p className="text-[0.98rem] opacity-90">{m.p}</p>
      </div>
      <div className="mt-1 flex justify-center gap-2" aria-hidden>{MESSAGES.map((_, k) => <span key={k} className="h-1.5 rounded-full transition-all" style={{ width: k === i ? 22 : 6, background: k === i ? "#1B365D" : "rgba(27,54,93,.25)" }} />)}</div>
    </div>
  );
}
