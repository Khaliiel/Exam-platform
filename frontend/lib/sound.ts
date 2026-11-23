// Calm ambient pad + spoken reminder + chime, all generated in the browser (no audio files).
// Browsers block sound until the page has had a click or key press, so start() retries on the first interaction.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let oscs: OscillatorNode[] = [];
let token = 0;
let unbind: (() => void) | null = null;
const KEY = "exam_sound";

export const enabled = () => (typeof localStorage === "undefined" ? true : localStorage.getItem(KEY) !== "off");
export function setEnabled(on: boolean) { try { localStorage.setItem(KEY, on ? "on" : "off"); } catch {} if (!on) stop(); }

function ensure(): AudioContext | null {
  if (ctx) return ctx;
  const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  return ctx;
}

function pad(c: AudioContext) {
  master = c.createGain();
  master.gain.setValueAtTime(0, c.currentTime);
  master.gain.linearRampToValueAtTime(0.05, c.currentTime + 3);
  master.connect(c.destination);
  const lfo = c.createOscillator(), lfoGain = c.createGain();
  lfo.frequency.value = 0.12; lfoGain.gain.value = 0.012;
  lfo.connect(lfoGain); lfoGain.connect(master.gain); lfo.start();
  oscs = [lfo];
  [130.81, 196.0, 261.63, 329.63, 392.0].forEach((f, i) => {
    const o = c.createOscillator(); o.type = "sine"; o.frequency.value = f; o.detune.value = (i % 2 ? 4 : -4);
    o.connect(master!); o.start(); oscs.push(o);
  });
}

function speak(text: string) {
  const s: SpeechSynthesis | undefined = (window as any).speechSynthesis;
  if (!s) return;
  s.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.92; u.pitch = 1; u.volume = 0.9;
  const v = s.getVoices().find((x) => /en[-_](GB|NG|US)/i.test(x.lang)) || s.getVoices().find((x) => /^en/i.test(x.lang));
  if (v) u.voice = v;
  s.speak(u);
}

export function start(text: string) {
  if (!enabled()) return;
  stop();
  const my = ++token;
  let started = false;
  const begin = () => {
    if (started || my !== token) return;
    const c = ensure();
    if (!c) return;
    c.resume().then(() => {
      if (started || my !== token || c.state !== "running") return;
      started = true; pad(c); speak(text);
    }).catch(() => {});
  };
  begin();
  const once = () => { begin(); };
  window.addEventListener("pointerdown", once);
  window.addEventListener("keydown", once);
  unbind = () => { window.removeEventListener("pointerdown", once); window.removeEventListener("keydown", once); };
}

export function stop() {
  token++;
  if (unbind) { unbind(); unbind = null; }
  try { (window as any).speechSynthesis?.cancel(); } catch {}
  if (ctx && master) {
    const m = master, list = oscs;
    m.gain.cancelScheduledValues(ctx.currentTime);
    m.gain.setValueAtTime(m.gain.value, ctx.currentTime);
    m.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
    setTimeout(() => { list.forEach((o) => { try { o.stop(); } catch {} }); try { m.disconnect(); } catch {} }, 700);
  }
  master = null; oscs = [];
}

export function chime() {
  if (!enabled()) return;
  const c = ensure();
  if (!c) return;
  c.resume().catch(() => {});
  [880, 1318.5].forEach((f, i) => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = "sine"; o.frequency.value = f;
    const t = c.currentTime + i * 0.12;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 1.4);
  });
}
