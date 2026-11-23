// Decorative academic marks for landing/check only. Never mounted on /exam.
const P = { fill: "none", stroke: "#1B365D", strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const ICONS: Record<string, JSX.Element> = {
  quill: <g {...P}><path d="M40 6C26 10 14 24 12 40l4 2c2-6 6-10 10-12M16 42l-4 8" /><path d="M40 6c0 14-8 24-20 28" /></g>,
  book: <g {...P}><path d="M6 12h18c4 0 6 2 6 6v24c0-3-2-5-6-5H6zM54 12H36c-4 0-6 2-6 6v24c0-3 2-5 6-5h18z" /></g>,
  hourglass: <g {...P}><path d="M14 6h28M14 50h28M16 6c0 14 12 16 12 22S16 36 16 50M40 6c0 14-12 16-12 22s12 8 12 22" /></g>,
  compass: <g {...P}><circle cx="28" cy="10" r="3" /><path d="M28 13L12 50M28 13l16 37M18 36h20" /></g>,
  laurel: <g {...P}><path d="M28 50C10 44 6 26 12 12M28 50c18-6 22-24 16-38M14 20c4 0 6 2 7 5M12 30c4 0 7 2 8 6M16 40c4-1 7 0 9 3M42 20c-4 0-6 2-7 5M44 30c-4 0-7 2-8 6M40 40c-4-1-7 0-9 3" /></g>,
  scroll: <g {...P}><path d="M14 8h30v34c0 4-3 6-6 6H12c3 0 4-2 4-6V8zM14 8c-4 0-6 2-6 5s2 4 6 4M24 20h14M24 28h14M24 36h10" /></g>,
};
const SPOTS = [
  ["quill", "6%", "14%", 70, 11, 18, -8, 6], ["book", "88%", "10%", 78, 13, -22, 4, -6], ["hourglass", "10%", "72%", 64, 12, 14, -4, 8],
  ["compass", "84%", "66%", 72, 14, -16, 6, -4], ["laurel", "46%", "4%", 66, 15, 10, -3, 3], ["scroll", "50%", "86%", 70, 12, -12, 5, -5],
] as const;

export default function FloatingIcons() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden opacity-[0.34]">
      {SPOTS.map(([name, left, top, size, dur, dx, r0, r1], i) => (
        <svg key={i} viewBox="0 0 56 56" width={size} height={size} className="drift absolute"
          style={{ left, top, ["--dur" as any]: dur + "s", ["--dx" as any]: dx + "px", ["--r0" as any]: r0 + "deg", ["--r1" as any]: r1 + "deg", animationDelay: -i * 2 + "s" }}>
          {ICONS[name]}
        </svg>
      ))}
    </div>
  );
}
