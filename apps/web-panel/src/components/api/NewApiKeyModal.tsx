import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { createApiKey, type ApiKeyEntry, type ApiKeyPreset } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import { NEVER_EXPOSED_MODULES, PRESETS, moduleLabel } from "./key-scopes";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";

const EXPIRY_OPTIONS: Array<{ label: string; days: number | undefined }> = [
  { label: "بدون انقضا", days: undefined },
  { label: "۳۰ روز", days: 30 },
  { label: "۹۰ روز", days: 90 },
  { label: "یک سال", days: 365 },
];

/** نمایش یک‌باره‌ی کلید خام (پس از ساخت یا چرخش). */
export function RawKeyReveal({ rawKey, onClose, note }: { rawKey: string; onClose: () => void; note?: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(rawKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="text-[12.5px] text-warning bg-warning-soft rounded-xl p-3.5 leading-relaxed">
        این کلید فقط همین یک‌بار نمایش داده می‌شود. آن را در جای امنی ذخیره کنید — بعد از بستن این پنجره دیگر قابل مشاهده نیست.
        {note ? <div className="mt-1.5">{note}</div> : null}
      </div>
      <div className="bg-slate-900 text-slate-100 rounded-xl p-3.5 text-[12.5px] font-mono break-all" dir="ltr">
        {rawKey}
      </div>
      <button onClick={handleCopy} className="w-full py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer">
        {copied ? "کپی شد ✓" : "کپی کردن کلید"}
      </button>
      <button onClick={onClose} className="text-[12.5px] text-muted font-semibold cursor-pointer">
        بستن
      </button>
    </div>
  );
}

export function NewApiKeyModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (key: ApiKeyEntry) => void;
}) {
  const { installedModules } = useWorkspace();
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<ApiKeyPreset>("read_only");
  const [modules, setModules] = useState<Set<string>>(new Set());
  const [expiryDays, setExpiryDays] = useState<number | undefined>(undefined);
  const [ips, setIps] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawKey, setRawKey] = useState<string | null>(null);

  const selectable = [...installedModules].filter((c) => !NEVER_EXPOSED_MODULES.has(c)).sort();

  function toggleModule(code: string) {
    setModules((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const ipAllowlist = ips
        .split(/[\s,،]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const key = await createApiKey({
        name: name.trim(),
        preset,
        modules: modules.size ? [...modules] : undefined,
        expiresInDays: expiryDays,
        ipAllowlist: ipAllowlist.length ? ipAllowlist : undefined,
      });
      setRawKey(key.rawKey);
      onCreated(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ساخت کلید انجام نشد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="کلید API جدید" onClose={onClose} width="max-w-[520px]">
      {rawKey ? (
        <RawKeyReveal rawKey={rawKey} onClose={onClose} />
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">نام کلید (برای شناسایی بعدی)</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثلاً دستیار گزارش‌گیری"
              className={inputClass}
            />
          </div>

          <div>
            <div className="text-[12px] font-semibold text-ink-soft mb-1.5">سطح دسترسی</div>
            <div className="flex flex-col gap-2">
              {PRESETS.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => setPreset(p.id)}
                  aria-pressed={preset === p.id}
                  className={`text-start rounded-xl border px-3.5 py-2.5 cursor-pointer transition-colors ${
                    preset === p.id ? "border-primary bg-primary-soft" : "border-border bg-slate-50 hover:border-primary/50"
                  }`}
                >
                  <div className="text-[12.5px] font-bold">{p.title}</div>
                  <div className="text-[11.5px] text-muted mt-0.5 leading-relaxed">{p.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {selectable.length > 0 ? (
            <div>
              <div className="text-[12px] font-semibold text-ink-soft mb-1">
                محدودکردن به ماژول‌های خاص <span className="text-muted font-normal">(اختیاری — خالی یعنی همه)</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selectable.map((c) => (
                  <button
                    type="button"
                    key={c}
                    onClick={() => toggleModule(c)}
                    aria-pressed={modules.has(c)}
                    className={`rounded-lg px-2.5 py-1 text-[11.5px] font-semibold border cursor-pointer ${
                      modules.has(c) ? "border-primary bg-primary text-white" : "border-border bg-slate-50 text-ink-soft"
                    }`}
                  >
                    {moduleLabel(c)}
                  </button>
                ))}
              </div>
              {modules.size > 0 ? (
                <p className="text-[11px] text-muted mt-1.5 leading-relaxed">
                  با این محدودیت، REST فقط به همین ماژول‌ها و بخش‌های متعلق به ماژول (مسیرهای عمومی بدون ماژول بسته می‌شود) پاسخ می‌دهد و MCP فقط ابزارهای همین ماژول‌ها را نشان می‌دهد.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">انقضا</label>
              <select
                value={expiryDays ?? ""}
                onChange={(e) => setExpiryDays(e.target.value ? Number(e.target.value) : undefined)}
                className={inputClass}
              >
                {EXPIRY_OPTIONS.map((o) => (
                  <option key={o.label} value={o.days ?? ""}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">IP مجاز (اختیاری)</label>
              <input
                value={ips}
                onChange={(e) => setIps(e.target.value)}
                placeholder="203.0.113.7, 10.0.0.0/24"
                className={`${inputClass} font-mono`}
                dir="ltr"
              />
            </div>
          </div>

          {error ? <div className="text-[12px] text-danger bg-danger-soft rounded-xl p-3">{error}</div> : null}

          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="mt-1 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
          >
            {submitting ? "در حال ساخت..." : "ساخت کلید"}
          </button>
        </form>
      )}
    </Modal>
  );
}
