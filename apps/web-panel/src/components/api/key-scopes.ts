import { MODULE_HELP_CONTENT } from "@/lib/module-help-content";
import type { ApiKeyEntry, ApiKeyPreset } from "@/lib/api";

export const PRESETS: Array<{ id: ApiKeyPreset; title: string; desc: string; recommended?: boolean }> = [
  {
    id: "read_only",
    title: "فقط‌خواندنی (پیشنهادی)",
    desc: "ایجنت فقط می‌تواند اطلاعات را ببیند و گزارش بگیرد؛ هیچ ثبتی، حتی درخواست تأیید، نمی‌تواند بفرستد.",
    recommended: true,
  },
  {
    id: "read_propose",
    title: "خواندن + ثبت درخواست‌های نیازمند تأیید",
    desc: "علاوه بر خواندن، ایجنت می‌تواند پیشنهاد ثبت/ویرایش بدهد؛ هیچ‌چیز بدون تأیید شما در پنل اجرا نمی‌شود.",
  },
  {
    id: "full",
    title: "دسترسی کامل REST",
    desc: "برای برنامه‌های خودتان: نوشتن مستقیم از طریق REST API هم مجاز است (MCP همچنان فقط درخواست تأیید ثبت می‌کند). فقط برای سیستم‌های مورداعتماد.",
  },
];

export const NEVER_EXPOSED_MODULES = new Set(["mcp", "api-access", "webhooks"]);

export function moduleLabel(code: string): string {
  return MODULE_HELP_CONTENT[code]?.title ?? code;
}

export type KeyAccess = {
  legacy: boolean;
  level: "legacy" | "read_only" | "read_propose" | "full";
  levelLabel: string;
  modules: string[];
  tools: string[];
};

export function describeKey(k: Pick<ApiKeyEntry, "scopes">): KeyAccess {
  const s = k.scopes ?? [];
  const modules = s.filter((x) => x.startsWith("module:")).map((x) => x.slice(7));
  const tools = s.filter((x) => x.startsWith("mcp:tools:")).map((x) => x.slice(10));
  if (s.length === 0) return { legacy: true, level: "legacy", levelLabel: "کلید قدیمی – دسترسی کامل", modules, tools };
  if (s.includes("write")) return { legacy: false, level: "full", levelLabel: "دسترسی کامل REST", modules, tools };
  if (s.includes("propose")) return { legacy: false, level: "read_propose", levelLabel: "خواندن + درخواست تأیید", modules, tools };
  return { legacy: false, level: "read_only", levelLabel: "فقط‌خواندنی", modules, tools };
}

export function isKeyExpired(k: Pick<ApiKeyEntry, "expiresAt">, now = Date.now()): boolean {
  return !!k.expiresAt && new Date(k.expiresAt).getTime() <= now;
}
