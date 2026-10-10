import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { ApiError, fetchProjectSmsSettings, saveProjectSmsSettings, type ProjectSmsEventKey, type ProjectSmsSettings } from "@/lib/api";
import { SmsTemplateField } from "@/components/projects/SmsTemplateField";

const EVENTS: { key: ProjectSmsEventKey; label: string; hint?: string }[] = [
  { key: "stageStarted", label: "شروع مرحله" },
  { key: "stageCompleted", label: "تکمیل مرحله", hint: "درصد پیشرفت را هم می‌توانید بیاورید" },
  { key: "projectCompleted", label: "تکمیل پروژه" },
  { key: "projectOnHold", label: "توقف پروژه" },
  { key: "projectCancelled", label: "لغو پروژه" },
  { key: "projectResumed", label: "از‌سرگیری پروژه" },
];

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`w-11 h-6 rounded-full relative transition-colors cursor-pointer shrink-0 ${on ? "bg-success" : "bg-slate-300"}`}
    >
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${on ? "right-[22px]" : "right-0.5"}`} />
    </button>
  );
}

/** تنظیمات پیامک پروژه: کلید اصلی (پیش‌فرض خاموش)، سوئیچ و متن هر رویداد، متن ارسال دستی و سقف‌ها. */
export function ProjectSmsSettingsModal({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<ProjectSmsSettings | null>(null);
  const [open, setOpen] = useState<string | null>("stageCompleted");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchProjectSmsSettings()
      .then(setS)
      .catch((e) => setError(e instanceof ApiError ? e.message : "بارگذاری تنظیمات ناموفق بود"));
  }, []);

  async function save() {
    if (!s) return;
    setBusy(true);
    setError(null);
    try {
      setS(await saveProjectSmsSettings(s));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "ذخیره‌سازی ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  const numInput = "w-20 text-[12.5px] outline-none bg-surface border border-border rounded-lg px-2.5 py-1.5 focus:border-primary text-center";

  return (
    <Modal title="تنظیمات پیامک پروژه" onClose={onClose} width="max-w-[620px]">
      {!s ? (
        <div className="text-center text-muted py-6 text-[13px]">{error ?? "در حال بارگذاری..."}</div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 bg-slate-50 border border-border rounded-xl p-3">
            <div>
              <div className="text-[13px] font-bold">ارسال خودکار پیامک به مشتری</div>
              <div className="text-[11px] text-muted mt-0.5 leading-5">تا روشن نکنید هیچ پیامکی ارسال نمی‌شود. هر پروژه هم کلید جداگانه دارد.</div>
            </div>
            <Switch on={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} label="ارسال خودکار پیامک" />
          </div>

          <div className="flex flex-col gap-2">
            {EVENTS.map((ev) => {
              const cfg = s.events[ev.key];
              const isOpen = open === ev.key;
              return (
                <div key={ev.key} className="border border-border rounded-xl">
                  <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                    <button type="button" onClick={() => setOpen(isOpen ? null : ev.key)} className="flex-1 text-right text-[12.5px] font-bold cursor-pointer">
                      {ev.label} <span className="text-[11px] text-muted font-normal">{isOpen ? "▲" : "▼"}</span>
                    </button>
                    <Switch on={cfg.enabled} onChange={(v) => setS({ ...s, events: { ...s.events, [ev.key]: { ...cfg, enabled: v } } })} label={ev.label} />
                  </div>
                  {isOpen ? (
                    <div className="px-3 pb-3">
                      <SmsTemplateField value={cfg.template} onChange={(t) => setS({ ...s, events: { ...s.events, [ev.key]: { ...cfg, template: t } } })} />
                    </div>
                  ) : null}
                </div>
              );
            })}
            <div className="border border-border rounded-xl">
              <button type="button" onClick={() => setOpen(open === "manual" ? null : "manual")} className="w-full text-right px-3 py-2.5 text-[12.5px] font-bold cursor-pointer">
                متن «ارسال وضعیت پروژه» (دستی) <span className="text-[11px] text-muted font-normal">{open === "manual" ? "▲" : "▼"}</span>
              </button>
              {open === "manual" ? (
                <div className="px-3 pb-3">
                  <SmsTemplateField value={s.manualTemplate} onChange={(t) => setS({ ...s, manualTemplate: t })} />
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-4 flex-wrap text-[12px] text-ink-soft">
            <label className="flex items-center gap-2">
              سقف روزانه‌ی هر پروژه
              <input type="number" min={1} max={50} value={s.maxPerProjectPerDay} onChange={(e) => setS({ ...s, maxPerProjectPerDay: Number(e.target.value) })} className={numInput} />
            </label>
            <label className="flex items-center gap-2">
              سقف روزانه‌ی کل
              <input type="number" min={1} max={5000} value={s.maxPerTenantPerDay} onChange={(e) => setS({ ...s, maxPerTenantPerDay: Number(e.target.value) })} className={numInput} />
            </label>
          </div>
          <div className="text-[11px] text-muted leading-5">
            لینک فقط برای پروژه‌هایی ارسال می‌شود که «لینک مستقیم» آن‌ها روشن است؛ در غیر این صورت بخش اختیاری [[ ]] حذف می‌شود. پیامک خودکار برای یک مرحله/رویداد ظرف ۱۰ دقیقه فقط یک‌بار ارسال می‌شود.
          </div>
          {error ? <div className="text-[12.5px] text-danger font-semibold">{error}</div> : null}
          <button disabled={busy} onClick={save} className="self-start text-[12.5px] font-bold px-5 py-2.5 rounded-xl bg-primary text-white cursor-pointer disabled:opacity-50">
            {saved ? "ذخیره شد ✓" : busy ? "در حال ذخیره..." : "ذخیره"}
          </button>
        </div>
      )}
    </Modal>
  );
}
