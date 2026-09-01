import type { Tone } from "@/components/ui/Badge";
import type { StockMovementType } from "@/lib/api";

export const MOVEMENT_TYPE_LABELS: Record<StockMovementType, string> = {
  RECEIPT: "رسید ورودی",
  ISSUE: "حواله خروجی",
  ADJUSTMENT: "اصلاح موجودی",
};

export const MOVEMENT_TYPE_TONES: Record<StockMovementType, Tone> = {
  RECEIPT: "success",
  ISSUE: "danger",
  ADJUSTMENT: "warning",
};
