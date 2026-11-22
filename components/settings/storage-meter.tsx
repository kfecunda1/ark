import { STORAGE_LIMIT_MB } from "@/lib/storage-usage";
import { getDictionary, type Lang } from "@/lib/i18n";

interface StorageMeterProps {
  usedBytes: number;
  lang?: Lang;
}

// Thresholds match the request this shipped from: amber above 75% of
// the plan limit, red above 90%.
export function StorageMeter({ usedBytes, lang = "en" }: StorageMeterProps) {
  const t = getDictionary(lang);
  const usedMb = usedBytes / (1024 * 1024);
  const percent = Math.min(100, (usedMb / STORAGE_LIMIT_MB) * 100);

  const tone = percent > 90 ? "red" : percent > 75 ? "amber" : "default";
  const textClass = tone === "red" ? "text-red-300" : tone === "amber" ? "text-amber-300" : "text-white/70";
  const barClass = tone === "red" ? "bg-red-400" : tone === "amber" ? "bg-amber-400" : "bg-accent";

  return (
    <div>
      <p className={`text-sm font-medium ${textClass}`}>
        {t.settingsStorage.usedLabel(usedMb.toFixed(1), STORAGE_LIMIT_MB.toLocaleString())}
      </p>
      <div className="mt-2 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-white/[0.08]">
        <div className={`h-full rounded-full transition-all duration-150 ease-out ${barClass}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
