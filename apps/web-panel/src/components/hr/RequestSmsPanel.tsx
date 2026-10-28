"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import {
  fetchHrRequestSmsSettings,
  updateHrRequestSmsSettings,
  fetchHrRequestSmsLog,
  ApiError,
  type HrRequestSmsLogRow,
  type HrRequestSmsSettingsResponse,
  type HrSmsEventKey,
} from "@/lib/api";
import { formatJalaliDate } from "@/lib/persian";

const fieldClass =
  "w-full text-[16px] sm:text-[13px] min-h-10 outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 min-h-10 text-[13px] cursor-pointer">
      <input type="checkbox" className="w-5 h-5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** تنظیمات پیامک اطلاع‌رسانی تصمیم درخواست‌ها (مرخصی و ...) — فقط مالک/مدیر می‌تواند ذخیره کند. */
export function RequestSmsSettingsPanel() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<HrRequestSmsSettingsResponse | null>(null);
  const [draft, setDraft] = useState<HrRequestSmsSettingsResponse["settings"] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || data) return;
    fetchHrRequestSmsSettings()
      .then((d) => {
        setData(d);
        setDraft(d.settings);
      })
      .catch((e) => setMsg({ ok: false, text: e instanceof ApiError ? e.message : "بارگذاری ناموفق بود" }));
  }, [open, data]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setMsg(null);
    try {
      const r = await updateHrRequestSmsSettings(draft);
      setDraft(r.settings);
      setMsg({ ok: true, text: "ذخیره شد" });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "ذخیره ناموفق بود" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mt-5 p-4">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between min-h-10 text-right cursor-pointer">
        <span className="text-[13.5px] font-extrabold">پیامک اطلاع‌رسانی نتیجه‌ی درخواست‌ها به درخواست‌کننده</span>
        <span className="text-[12px] text-muted">{open ? "بستن" : "تنظیمات"}</span>
      </button>
      {open ? (
        !data || !draft ? (
          <div className="text-muted text-sm py-4">{msg ? msg.text : "در حال بارگذاری..."}</div>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <Toggle checked={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })} label="ارسال پیامک فعال باشد" />
            <div>
              <div className="text-[12px] font-semibold text-ink-soft mb-1">نوع درخواست</div>
              {data.types.map((t) => (
                <Toggle key={t.key} checked={!!draft.types[t.key]} onChange={(v) => setDraft({ ...draft, types: { ...draft.types, [t.key]: v } })} label={t.label} />
              ))}
            </div>
            <div>
              <div className="text-[12px] font-semibold text-ink-soft mb-1">رویدادها و قالب پیامک</div>
              {data.events.map((e) => (
                <div key={e.key} className="mb-3">
                  <Toggle
                    checked={draft.events[e.key]}
                    onChange={(v) => setDraft({ ...draft, events: { ...draft.events, [e.key]: v } })}
                    label={e.label}
                  />
                  <textarea
                    rows={2}
                    maxLength={400}
                    value={draft.templates[e.key]}
                    onChange={(ev) => setDraft({ ...draft, templates: { ...draft.templates, [e.key]: ev.target.value } })}
                    className={fieldClass}
                  />
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, templates: { ...draft.templates, [e.key]: data.defaultTemplates[e.key] } })}
                    className="text-[11.5px] text-primary font-bold min-h-10 cursor-pointer"
                  >
                    بازگردانی قالب پیش‌فرض
                  </button>
                </div>
              ))}
              <div className="text-[11.5px] text-muted leading-6" dir="rtl">
                جانشین‌های مجاز:{" "}
                {data.placeholders.map((p) => (
                  <span key={p.key} className="inline-block ms-1" title={p.label}>
                    <code dir="ltr">{`{{${p.key}}}`}</code>
                  </span>
                ))}
                <br />
                مبلغ و حقوق هرگز در پیامک نمی‌آید. دلیل رد حداکثر ۵۰ نویسه درج می‌شود.
              </div>
            </div>
            <div>
              <label className="text-[12px] font-semibold text-ink-soft mb-1 block">سقف پیامک روزانه (کل سازمان)</label>
              <input
                dir="ltr"
                inputMode="numeric"
                className={fieldClass}
                value={String(draft.dailyCap)}
                onChange={(e) => setDraft({ ...draft, dailyCap: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })}
              />
            </div>
            {msg ? <div className={`text-[12px] ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</div> : null}
            <button
              onClick={save}
              disabled={saving}
              className="min-h-10 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer disabled:opacity-50"
            >
              {saving ? "در حال ذخیره..." : "ذخیره تنظیمات"}
            </button>
          </div>
        )
      ) : null}
    </Card>
  );
}

const EVENT_FA: Record<HrSmsEventKey, string> = { SUBMITTED: "ثبت", APPROVED: "تأیید", REJECTED: "رد", CANCELLED: "لغو" };
const STATUS_FA: Record<HrRequestSmsLogRow["status"], string> = { PENDING: "در حال ارسال", SENT: "ارسال شد", FAILED: "ناموفق", SKIPPED: "ارسال نشد" };

/** «پیامک‌های ارسال‌شده» یک درخواست — برای مدیر منابع انسانی (بدون متن پیامک). */
export function RequestSmsLog({ type, id }: { type: string; id: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<HrRequestSmsLogRow[] | null>(null);

  useEffect(() => {
    if (!open) return;
    fetchHrRequestSmsLog(type, id).then(setRows).catch(() => setRows([]));
  }, [open, type, id]);

  return (
    <div className="basis-full">
      <button onClick={() => setOpen((v) => !v)} className="text-[11.5px] font-bold text-primary min-h-10 cursor-pointer">
        {open ? "بستن پیامک‌های ارسال‌شده" : "پیامک‌های ارسال‌شده"}
      </button>
      {open ? (
        <div className="text-[11.5px] text-muted flex flex-col gap-1 pb-1">
          {rows === null ? (
            <span>در حال بارگذاری...</span>
          ) : rows.length === 0 ? (
            <span>پیامکی برای این درخواست ثبت نشده است.</span>
          ) : (
            rows.map((r) => (
              <span key={r.id}>
                {EVENT_FA[r.event]} — {STATUS_FA[r.status]}
                {r.maskedPhone ? ` — ${r.maskedPhone}` : ""} — {formatJalaliDate(r.createdAt)}
                {r.reason ? ` (${r.reason})` : ""}
              </span>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
