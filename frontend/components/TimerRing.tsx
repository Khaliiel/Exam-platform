export default function TimerRing({ remainingMs, totalMs, size = 68 }: { remainingMs: number; totalMs: number; size?: number }) {
  const r = size / 2 - 5, c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, remainingMs / totalMs));
  const secs = Math.max(0, Math.ceil(remainingMs / 1000));
  const color = secs <= 4 ? "#B91C1C" : secs <= 8 ? "#D97706" : "#1B365D";
  return (
    <svg width={size} height={size} role="timer" aria-label={`${secs} seconds left for this question`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e7e3da" strokeWidth="4" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 0.25s linear, stroke 0.3s" }} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize="22" fill={color}>{secs}</text>
    </svg>
  );
}
