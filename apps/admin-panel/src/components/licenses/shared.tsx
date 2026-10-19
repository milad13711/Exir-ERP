import { Badge, type Tone } from "@/components/ui/Badge";
import type { EffectiveStatus } from "@/lib/licenses-api";

export const STATUS_LABEL: Record<EffectiveStatus, string> = { active: "فعال", expired: "منقضی", suspended: "معلق", revoked: "لغوشده" };
export const STATUS_TONE: Record<EffectiveStatus, Tone> = { active: "success", expired: "warning", suspended: "accent", revoked: "danger" };

export function StatusChip({ status }: { status: EffectiveStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function errMsg(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
