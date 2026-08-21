interface Props {
  used: number;
  limit: number;
  color?: string;
}

export function ProgressBar({ used, limit, color = "#10b981" }: Props) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const exceeded = used > limit;
  const nearLimit = pct >= 80 && !exceeded;

  const barColor = exceeded ? "#ef4444" : nearLimit ? "#f59e0b" : color;

  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, backgroundColor: barColor }}
      />
    </div>
  );
}
