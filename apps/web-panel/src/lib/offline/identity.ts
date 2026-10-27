import type { Identity } from "./types";

/** هویت (تننت/کاربر) را از خودِ JWT می‌خواند — بدون شبکه، تا هنگام آفلاین هم در دسترس باشد. اعتبارسنجی امضا کار سرور است. */
export function identityFromToken(token: string | null | undefined): Identity | null {
  if (!token) return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const json = decodeURIComponent(
      atob(b64)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(""),
    );
    const p = JSON.parse(json) as { type?: string; sub?: unknown; tenantId?: unknown };
    if (p.type !== "tenant_user" || typeof p.sub !== "string" || typeof p.tenantId !== "string") return null;
    return { tenantId: p.tenantId, userId: p.sub };
  } catch {
    return null;
  }
}
