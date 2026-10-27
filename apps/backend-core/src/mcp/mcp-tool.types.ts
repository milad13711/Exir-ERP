import type { TenantRequestContext } from '../common/request-context.js';

/** JSON Schema, kept intentionally loose (this repo has no schema-builder dependency). Validated by mcp-validate.ts. */
export type JsonSchema = Record<string, unknown>;

export type McpToolKind = 'read' | 'write';

export type McpTool = {
  /** نام انگلیسی پایدار — قرارداد با ایجنت‌ها و فهرست مجاز `mcp:tools:<name>`؛ هرگز تغییر نام نده. */
  name: string;
  /** توضیح فارسی برای مدل. */
  description: string;
  inputSchema: JsonSchema;
  /** کد ماژول (هم‌کد با @RequireModule) — برای بررسی «ماژول نصب است؟» و فیلتر دامنه‌ی کلید. */
  module: string;
  /** read: بلافاصله اجرا می‌شود. write: هرگز روی نوبت ایجنت اجرا نمی‌شود؛ فقط درخواست تأیید ثبت می‌شود. */
  kind: McpToolKind;
  /** READ runs immediately when called. CREATE/UPDATE/DELETE never run on the caller's turn — see mcp.controller.ts — they only run once a human approves the pending request this produces, via the same handler. */
  operation: 'READ' | 'CREATE' | 'UPDATE' | 'DELETE';
  /** Required for every non-READ tool — the human-readable line shown on the approval popup/list. */
  summarize?: (args: Record<string, unknown>) => string;
  /** اعتبارسنجی دقیق ورودی (در ثبت درخواست و دوباره هنگام اجرای تأییدشده). خطا = Error با پیام فارسی. */
  validate?: (args: Record<string, unknown>) => void;
  handler: (args: Record<string, unknown>, ctx: TenantRequestContext) => Promise<unknown>;
};

/** فقط متادیتای ابزار (برای فیلتر دامنه‌ی کلید بدون وابستگی به handler). */
export type McpToolMeta = Pick<McpTool, 'name' | 'module' | 'kind'>;
