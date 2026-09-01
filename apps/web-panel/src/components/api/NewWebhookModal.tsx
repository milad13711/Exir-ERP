import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { createWebhook, type WebhookSubscription } from "@/lib/api";
import { WEBHOOK_EVENT_LABELS } from "./webhook-labels";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";

export function NewWebhookModal({
  events,
  onClose,
  onCreated,
}: {
  events: string[];
  onClose: () => void;
  onCreated: (webhook: WebhookSubscription) => void;
}) {
  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(event: string) {
    setSelected((prev) => (prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || selected.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const webhook = await createWebhook(url.trim(), selected);
      onCreated(webhook);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="وب‌هوک جدید" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">آدرس دریافت رویداد (URL)</label>
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/webhooks/exir"
            className={inputClass}
            dir="ltr"
          />
        </div>
        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">رویدادها</label>
          <div className="flex flex-col gap-2 bg-slate-50 border border-border rounded-xl p-3">
            {events.map((event) => (
              <label key={event} className="flex items-center gap-2 text-[12.5px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.includes(event)}
                  onChange={() => toggle(event)}
                  className="w-4 h-4 accent-[var(--color-primary)]"
                />
                <span dir="ltr" className="font-mono text-[11px] text-muted">
                  {event}
                </span>
                <span>{WEBHOOK_EVENT_LABELS[event] ?? event}</span>
              </label>
            ))}
          </div>
        </div>
        {error ? <div className="text-[12px] text-danger">{error}</div> : null}
        <button
          type="submit"
          disabled={submitting || !url.trim() || selected.length === 0}
          className="mt-1.5 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {submitting ? "در حال ثبت..." : "ثبت وب‌هوک"}
        </button>
      </form>
    </Modal>
  );
}
