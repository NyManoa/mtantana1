import { useMemo } from "react";
import { formatAriary } from "@/lib/format";
import type { Lang } from "@/lib/i18n";
import { t, categoryLabel } from "@/lib/i18n";

export interface PieSlice {
  categorie: string;
  couleur: string;
  total: number;
}

interface Props {
  data: PieSlice[];
  lang: Lang;
}

export function CategoryPieChart({ data, lang }: Props) {
  const total = useMemo(() => data.reduce((s, d) => s + d.total, 0), [data]);

  if (data.length === 0 || total === 0) {
    return <div className="py-8 text-center text-sm text-slate-500">{t(lang, "noTransactions")}</div>;
  }

  let cumulative = 0;
  const radius = 70;
  const cx = 90;
  const cy = 90;
  const circumference = 2 * Math.PI * radius;

  const segments = data.map((d) => {
    const fraction = d.total / total;
    const dash = fraction * circumference;
    const offset = -cumulative * circumference;
    cumulative += fraction;
    return { ...d, dash, offset, fraction };
  });

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
      <svg width={180} height={180} viewBox="0 0 180 180" className="shrink-0">
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#1e293b" strokeWidth={radius} />
        {segments.map((s, i) => (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={s.couleur}
            strokeWidth={radius}
            strokeDasharray={`${s.dash} ${circumference - s.dash}`}
            strokeDashoffset={s.offset}
            transform={`rotate(-90 ${cx} ${cy})`}
            className="transition-all duration-500"
          >
            <title>{`${categoryLabel(lang, s.categorie)}: ${formatAriary(s.total, lang)} (${Math.round(s.fraction * 100)}%)`}</title>
          </circle>
        ))}
        <circle cx={cx} cy={cy} r={radius * 0.55} fill="#0b1220" />
        <text x={cx} y={cy - 4} textAnchor="middle" className="fill-slate-400 text-[9px] font-semibold">
          {t(lang, "totalExpense")}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" className="fill-white text-[11px] font-bold">
          {formatAriary(total, lang)}
        </text>
      </svg>
      <div className="flex flex-col gap-1.5">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: s.couleur }} />
            <span className="text-slate-300">{categoryLabel(lang, s.categorie)}</span>
            <span className="ml-auto font-semibold text-slate-400">
              {Math.round((s.total / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
