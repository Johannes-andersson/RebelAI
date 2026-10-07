import { fitLabel } from "@/lib/mock-data";
import type { ModelFit } from "@/lib/types";

const tone: Record<ModelFit, string> = {
  recommended: "bg-primary-soft text-primary",
  good: "bg-success-soft text-success",
  slow: "bg-warning-soft text-warning",
  "not-recommended": "bg-muted text-muted-foreground",
};

export function FitBadge({ fit }: { fit: ModelFit }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tone[fit]}`}>
      {fitLabel[fit]}
    </span>
  );
}
