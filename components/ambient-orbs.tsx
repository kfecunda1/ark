export function AmbientOrbs() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute -top-40 -left-32 h-[32rem] w-[32rem] rounded-full bg-accent/20 blur-[120px]"
        style={{ animation: "orb-float-1 22s ease-in-out infinite" }}
      />
      <div
        className="absolute top-1/3 -right-40 h-[28rem] w-[28rem] rounded-full bg-silver/15 blur-[120px]"
        style={{ animation: "orb-float-2 26s ease-in-out infinite" }}
      />
      <div
        className="absolute -bottom-40 left-1/4 h-[26rem] w-[26rem] rounded-full bg-accent-soft/15 blur-[120px]"
        style={{ animation: "orb-float-3 30s ease-in-out infinite" }}
      />
    </div>
  );
}
