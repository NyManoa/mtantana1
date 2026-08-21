import { useMemo } from "react";
import { formatAriary } from "@/lib/format";
import type { Lang } from "@/lib/i18n";
import { t } from "@/lib/i18n";

export interface MonthlyPoint {
  month: string;
  income: number;
  expense: number;
}

interface Props {
  data: MonthlyPoint[];
  lang: Lang;
}

export function MonthlyBarChart({ data, lang }: Props) {
  const maxVal = useMemo(() => {
    const m = Math.max(...data.map((d) => Math.max(d.income, d.expense)), 1);
    return m;
  }, [data]);

  if (data.length === 0) {
    return <div className="py-8 text-center text-sm text-slate-500">{t(lang, "noTransactions")}</div>;
  }

  return (
    <div className="flex items-end justify-around gap-2 px-2" style={{ height: 200 }}>
      {data.map((d) => (
        <div key={d.month} className="flex flex-1 flex-col items-center gap-1.5">
          <div className="flex h-full w-full items-end justify-center gap-1">
            <div
              className="w-1/2 max-w-[24px] rounded-t-md bg-gradient-to-t from-emerald-600 to-emerald-400 transition-all duration-500 hover:from-emerald-500 hover:to-emerald-300"
              style={{ height: `${(d.income / maxVal) * 100}%`, minHeight: d.income > 0 ? 4 : 0 }}
              title={`${t(lang, "income")}: ${formatAriary(d.income, lang)}`}
            />
            <div
              className="w-1/2 max-w-[24px] rounded-t-md bg-gradient-to-t from-rose-600 to-rose-400 transition-all duration-500 hover:from-rose-500 hover:to-rose-300"
              style={{ height: `${(d.expense / maxVal) * 100}%`, minHeight: d.expense > 0 ? 4 : 0 }}
              title={`${t(lang, "expense")}: ${formatAriary(d.expense, lang)}`}
            />
          </div>
          <span className="text-[10px] font-medium text-slate-500">{d.month}</span>
        </div>
      ))}
    </div>
  );
}
