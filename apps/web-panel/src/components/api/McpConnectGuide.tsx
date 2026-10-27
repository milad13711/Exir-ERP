"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";

const KEY_PLACEHOLDER = "exir_live_کلید-شما-را-اینجا-بگذارید";

type ClientId = "claude" | "cursor" | "generic";

function snippetFor(client: ClientId, url: string): string {
  const key = "exir_live_XXXXXXXXXXXXXXXXXXXXXXXX";
  if (client === "claude") {
    return JSON.stringify(
      {
        mcpServers: {
          "exir-erp": {
            command: "npx",
            args: ["-y", "mcp-remote", url, "--header", "Authorization:${EXIR_AUTH}"],
            env: { EXIR_AUTH: `Bearer ${key}` },
          },
        },
      },
      null,
      2,
    );
  }
  if (client === "cursor") {
    return JSON.stringify({ mcpServers: { "exir-erp": { url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2);
  }
  return `آدرس سرور (Streamable HTTP):\n${url}\n\nهدر احراز هویت:\nAuthorization: Bearer ${key}`;
}

const CLIENT_LABELS: Record<ClientId, string> = {
  claude: "Claude Desktop",
  cursor: "Cursor",
  generic: "سایر کلاینت‌ها",
};

const CLIENT_HINTS: Record<ClientId, string> = {
  claude: "فایل claude_desktop_config.json را باز کنید (Settings ← Developer ← Edit Config)، این بلوک را اضافه کنید و برنامه را دوباره باز کنید. به Node.js نیاز دارد.",
  cursor: "فایل ‎~/.cursor/mcp.json یا Settings ← MCP ← Add new server را باز کنید و این بلوک را قرار دهید.",
  generic: "هر کلاینتی که MCP روی HTTP (Streamable HTTP) و هدر سفارشی را پشتیبانی کند همین دو مقدار را می‌خواهد.",
};

function CopyButton({ text, label = "کپی" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        });
      }}
      className="text-[11px] font-bold text-primary cursor-pointer shrink-0"
    >
      {done ? "کپی شد ✓" : label}
    </button>
  );
}

const STEPS: Array<{ title: string; body: string }> = [
  { title: "ماژول را فعال کنید", body: "از «فروشگاه ماژول‌ها» ماژول «اتصال API و MCP» را فعال کنید. ایجنت فقط به ماژول‌هایی دسترسی دارد که خودتان نصب کرده‌اید." },
  { title: "یک کلید با کمترین دسترسی بسازید", body: "در بخش «کلیدهای API» کلید جدید بسازید. برای شروع «فقط‌خواندنی» را بگذارید؛ هر وقت لازم شد کلید جدیدتری با «خواندن + درخواست تأیید» بسازید و کلید قبلی را باطل کنید." },
  { title: "کلید را همان لحظه کپی کنید", body: "کلید فقط یک‌بار نمایش داده می‌شود. آن را جایی عمومی (چت، گیت، اسکرین‌شات) قرار ندهید." },
  { title: "تنظیمات را در برنامه‌ی هوش مصنوعی وارد کنید", body: "بلوک مناسب را از پایین کپی کنید و به‌جای XXXX کلید خودتان را بگذارید." },
  { title: "امتحان کنید", body: "از ایجنت بپرسید: «وظایف معوق من را فهرست کن». برای هر ثبت/ویرایش، درخواستی در «دستیار هوشمند (MCP)» می‌آید که باید تأیید کنید." },
];

export function McpConnectGuide({ mcpUrl }: { mcpUrl: string }) {
  const [open, setOpen] = useState(false);
  const [client, setClient] = useState<ClientId>("claude");
  const snippet = snippetFor(client, mcpUrl);

  return (
    <div className="mt-4 rounded-xl border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-4 py-3 text-[13px] font-bold cursor-pointer"
      >
        <span className="flex items-center gap-2">
          راهنمای اتصال گام‌به‌گام
          <Badge tone="primary">۵ گام</Badge>
        </span>
        <span className="text-muted text-[12px]">{open ? "بستن ▲" : "باز کردن ▼"}</span>
      </button>

      {open ? (
        <div className="px-4 pb-4 flex flex-col gap-4 border-t border-border pt-4">
          {/* نمودار جریان */}
          <svg viewBox="0 0 520 70" className="w-full max-w-[520px] mx-auto" role="img" aria-label="جریان: ایجنت هوش مصنوعی، سرور MCP اکسیر، صف تأیید شما">
            <g fontFamily="inherit" fontSize="11" textAnchor="middle">
              <rect x="4" y="14" width="140" height="42" rx="10" fill="none" stroke="currentColor" opacity=".5" />
              <text x="74" y="39" fill="currentColor">ایجنت هوش مصنوعی</text>
              <rect x="190" y="14" width="140" height="42" rx="10" fill="none" stroke="currentColor" opacity=".5" />
              <text x="260" y="39" fill="currentColor">سرور MCP اکسیر</text>
              <rect x="376" y="14" width="140" height="42" rx="10" fill="none" stroke="currentColor" opacity=".5" />
              <text x="446" y="39" fill="currentColor">تأیید شما در پنل</text>
              <path d="M144 35h46M330 35h46" stroke="currentColor" opacity=".6" strokeWidth="1.5" />
              <path d="M184 31l6 4-6 4M370 31l6 4-6 4" fill="none" stroke="currentColor" opacity=".6" strokeWidth="1.5" />
              <text x="167" y="26" fill="currentColor" opacity=".7" fontSize="9">کلید</text>
              <text x="353" y="26" fill="currentColor" opacity=".7" fontSize="9">فقط ثبت‌ها</text>
            </g>
          </svg>

          <ol className="flex flex-col gap-2.5">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-primary text-white text-[10.5px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <span className="text-[12.5px] text-ink-soft leading-relaxed">
                  <b className="text-ink">{s.title}.</b> {s.body}
                </span>
              </li>
            ))}
          </ol>

          <div className="bg-slate-50 border border-border rounded-xl p-3.5">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11px] text-muted">آدرس سرور شما</div>
              <CopyButton text={mcpUrl} />
            </div>
            <code className="text-[12px] font-mono text-ink break-all" dir="ltr">
              {mcpUrl}
            </code>
          </div>

          <div>
            <div className="flex items-center gap-1.5 mb-2 flex-wrap">
              {(Object.keys(CLIENT_LABELS) as ClientId[]).map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setClient(c)}
                  aria-pressed={client === c}
                  className={`rounded-lg px-2.5 py-1 text-[11.5px] font-semibold border cursor-pointer ${
                    client === c ? "border-primary bg-primary text-white" : "border-border bg-slate-50 text-ink-soft"
                  }`}
                >
                  {CLIENT_LABELS[c]}
                </button>
              ))}
            </div>
            <p className="text-[11.5px] text-muted mb-2 leading-relaxed">{CLIENT_HINTS[client]}</p>
            <div className="bg-slate-900 text-slate-100 rounded-xl p-3.5">
              <div className="flex justify-end mb-1.5">
                <CopyButton text={snippet} label="کپی بلوک" />
              </div>
              <pre className="text-[11.5px] font-mono whitespace-pre-wrap break-all" dir="ltr">
                {snippet}
              </pre>
            </div>
            <p className="text-[11px] text-muted mt-1.5">به‌جای <code dir="ltr">exir_live_XXXX…</code> کلید ساخته‌شده را بگذارید ({KEY_PLACEHOLDER}).</p>
          </div>

          <div className="rounded-xl bg-warning-soft text-warning p-3.5 text-[12px] leading-relaxed">
            <b>نکته‌های امنیتی:</b> کلید را فقط‌خواندنی شروع کنید؛ به ماژول‌های لازم و در صورت ثابت‌بودن IP، به همان IP محدود کنید؛ انقضا بگذارید؛
            کلید لو رفته را فوراً «ابطال» و کلید جدید را با «چرخش» بسازید.
          </div>

          <div className="text-[12px] text-muted leading-relaxed">
            <b className="text-ink-soft">عیب‌یابی:</b> ۴۰۱ = کلید اشتباه، باطل، منقضی یا از IP غیرمجاز · ۴۰۳ = کلید دسترسی آن بخش را ندارد (فقط‌خواندنی است یا ماژول مجاز نیست)
            · «ماژول فعال نیست» = ماژول آن ابزار را نصب نکرده‌اید. راهنمای کامل: <code dir="ltr">docs/mcp/customer-guide-fa.md</code>.
          </div>
        </div>
      ) : null}
    </div>
  );
}
