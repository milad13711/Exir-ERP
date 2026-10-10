import { useEffect, useState } from "react";
import { fetchProjectPublicLink, regenerateProjectPublicLink, setProjectPublicLink, type ProjectPublicLink } from "@/lib/api";

/** لینک عمومی پیگیری برای مشتری: روشن/خاموش، کپی و ساخت لینک جدید (لینک قبلی باطل می‌شود). */
export function ProjectShareSection({ projectId }: { projectId: string }) {
  const [link, setLink] = useState<ProjectPublicLink | null>(null);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProjectPublicLink(projectId)
      .then(setLink)
      .catch(() => setDenied(true));
  }, [projectId]);

  if (denied) return null;

  async function run(fn: () => Promise<ProjectPublicLink>) {
    setBusy(true);
    setError(null);
    try {
      setLink(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : "عملیات ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="bg-slate-50 border border-border rounded-xl p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[12.5px] font-semibold text-ink-soft">لینک عمومی برای مشتری</div>
          <div className="text-[11px] text-muted mt-0.5">پیشرفت و فقط مواردی که «نمایش به مشتری» شده‌اند دیده می‌شود.</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={link?.enabled ?? false}
          aria-label="فعال‌بودن لینک عمومی"
          disabled={busy || !link}
          onClick={() => link && run(() => setProjectPublicLink(projectId, !link.enabled))}
          className={`w-11 h-6 rounded-full relative transition-colors cursor-pointer disabled:opacity-50 shrink-0 ${link?.enabled ? "bg-success" : "bg-slate-300"}`}
        >
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${link?.enabled ? "right-[22px]" : "right-0.5"}`} />
        </button>
      </div>
      {link?.enabled ? (
        <div className="mt-2.5 flex flex-col gap-2">
          <input readOnly dir="ltr" value={link.url} onFocus={(e) => e.currentTarget.select()} className="w-full text-[11.5px] bg-white border border-border rounded-lg px-2.5 py-1.5 outline-none" />
          <div className="flex items-center gap-3">
            <button type="button" onClick={copy} className="text-[11.5px] font-bold text-primary cursor-pointer">
              {copied ? "کپی شد" : "کپی لینک"}
            </button>
            <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-[11.5px] font-bold text-ink-soft">
              پیش‌نمایش
            </a>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm("لینک جدید ساخته شود؟ لینک قبلی دیگر کار نخواهد کرد.")) run(() => regenerateProjectPublicLink(projectId));
              }}
              className="text-[11.5px] font-bold text-danger cursor-pointer disabled:opacity-50 mr-auto"
            >
              ساخت لینک جدید
            </button>
          </div>
        </div>
      ) : null}
      {error ? <div className="text-[11.5px] text-danger font-semibold mt-2">{error}</div> : null}
    </div>
  );
}
