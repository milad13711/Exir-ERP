import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { ApiError, fetchProjectSmsPreview, sendProjectSms, setProjectSmsNotify, type ProjectSmsPreview } from "@/lib/api";
import { smsPartsOf } from "@/lib/sms-parts";
import { useWorkspace } from "@/lib/workspace-context";

/** پیامک وضعیت به مشتری: کلید اختصاصی پروژه (پیروی از پیش‌فرض / روشن / خاموش) + ارسال دستی با پیش‌نمایش قابل‌ویرایش. */
export function ProjectSmsSection({ projectId, initial, onSent }: { projectId: string; initial: boolean | null; onSent: () => void }) {
  const { me } = useWorkspace();
  const [mode, setMode] = useState<boolean | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<ProjectSmsPreview | null>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);

  async function change(v: string) {
    const next = v === "default" ? null : v === "on";
    setBusy(true);
    setError(null);
    try {
      await setProjectSmsNotify(projectId, next);
      setMode(next);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "ذخیره ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function openManual() {
    setError(null);
    setNotice(null);
    try {
      const p = await fetchProjectSmsPreview(projectId);
      setPreview(p);
      setText(p.message);
      setOpen(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "آماده‌سازی پیامک ناموفق بود");
    }
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await sendProjectSms(projectId, text);
      setOpen(false);
      setNotice("پیامک وضعیت ارسال شد");
      onSent();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "ارسال ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  const perm = me?.permissions;
  if (perm && !perm.manager && !perm.modules?.projects?.canEdit) return null;

  return (
    <div className="bg-slate-50 border border-border rounded-xl p-3 flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[12.5px] font-semibold text-ink-soft">پیامک وضعیت به مشتری</div>
          <div className="text-[11px] text-muted mt-0.5">پیامک خودکار تغییر مرحله/وضعیت برای این پروژه</div>
        </div>
        <select value={mode === null ? "default" : mode ? "on" : "off"} disabled={busy} onChange={(e) => change(e.target.value)} aria-label="پیامک خودکار این پروژه" className="text-[12px] bg-white border border-border rounded-lg px-2.5 py-1.5 outline-none">
          <option value="default">طبق تنظیمات ماژول</option>
          <option value="on">روشن</option>
          <option value="off">خاموش</option>
        </select>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={openManual} disabled={busy} className="text-[12px] font-bold text-primary bg-primary-soft px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50">
          ارسال پیامک وضعیت به مشتری
        </button>
        {notice ? <span className="text-[11.5px] text-success font-semibold">{notice}</span> : null}
      </div>
      {error && !open ? <div className="text-[11.5px] text-danger font-semibold">{error}</div> : null}

      {open && preview ? (
        <Modal title="ارسال پیامک وضعیت" onClose={() => setOpen(false)} width="max-w-[440px]">
          <div className="flex flex-col gap-3">
            <div className="text-[12.5px]">
              گیرنده: <b>{preview.contactName ?? "—"}</b> <span dir="ltr" className="text-muted">{preview.phoneMasked ?? ""}</span>
            </div>
            {!preview.canSend ? <div className="text-[12px] text-danger font-semibold">مشتری این پروژه شماره‌ی موبایل معتبر ندارد؛ ارسال ممکن نیست.</div> : null}
            {!preview.hasLink ? <div className="text-[11.5px] text-warning">لینک عمومی این پروژه خاموش است؛ پیام بدون لینک ارسال می‌شود.</div> : null}
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={500} className="w-full text-[13px] leading-6 outline-none bg-surface border border-border rounded-xl px-3 py-2 focus:border-primary" />
            <div className="text-[11px] text-muted">
              {text.length} نویسه · حدود {smsPartsOf(text)} پیامک
            </div>
            {error ? <div className="text-[12px] text-danger font-semibold">{error}</div> : null}
            <div className="flex items-center gap-2">
              <button type="button" onClick={send} disabled={busy || !preview.canSend || !text.trim()} className="text-[12.5px] font-bold px-5 py-2.5 rounded-xl bg-primary text-white cursor-pointer disabled:opacity-50">
                {busy ? "در حال ارسال..." : "تأیید و ارسال"}
              </button>
              <button type="button" onClick={() => setOpen(false)} className="text-[12px] font-bold text-ink-soft cursor-pointer">
                انصراف
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
