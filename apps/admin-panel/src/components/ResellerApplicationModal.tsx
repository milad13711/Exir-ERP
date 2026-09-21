"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import {
  approveResellerApplication,
  deleteResellerApplication,
  fetchResellerApplication,
  rejectResellerApplication,
  updateResellerApplication,
  ApiError,
  type ResellerApplication,
} from "@/lib/api";

const PRODUCTS = [
  { value: "ERP", label: "اکسیر ERP" },
  { value: "REAL_ESTATE", label: "اکسیراملاک" },
  { value: "SMS_GATEWAY", label: "اکسیر اس‌ام‌اس" },
  { value: "OTHER", label: "سایر" },
];
const FIELD = "w-full text-[13px] outline-none bg-slate-50 border border-border rounded-lg px-3 py-2 focus:border-primary";

/** جزئیات کامل درخواست همکار: مشاهده، تماس، ویرایش اطلاعات، تأیید (ساخت پروفایل + پین نقشه)، رد با دلیل و حذف. */
export function ResellerApplicationModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [app, setApp] = useState<(ResellerApplication & { reviewedBy?: { name: string } | null }) | null>(null);
  const [form, setForm] = useState<Partial<ResellerApplication>>({});
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetchResellerApplication(id)
      .then((a) => {
        setApp(a);
        setForm(a);
      })
      .catch(() => setError("بارگذاری ناموفق بود"));
  }
  useEffect(load, [id]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "انجام عملیات ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  if (!app) return <Modal title="درخواست همکار" onClose={onClose}><div className="text-muted text-sm">{error ?? "در حال بارگذاری..."}</div></Modal>;

  const set = (k: keyof ResellerApplication, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const pending = app.status === "PENDING";

  return (
    <Modal title={`درخواست همکار — ${app.name}`} onClose={onClose} width="max-w-[560px]">
      <div className="flex flex-col gap-3.5">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone={app.status === "APPROVED" ? "success" : app.status === "REJECTED" ? "danger" : "warning"}>
            {app.status === "APPROVED" ? "تأیید شده" : app.status === "REJECTED" ? "رد شده" : "در انتظار بررسی"}
          </Badge>
          <a href={`tel:${app.phone}`} dir="ltr" className="text-[12.5px] font-bold text-primary bg-primary-soft px-3 py-1 rounded-lg">
            تماس با {app.phone}
          </a>
        </div>

        {editing ? (
          <div className="grid grid-cols-2 gap-2.5">
            <input className={FIELD} placeholder="نام" value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} />
            <input className={FIELD} placeholder="شرکت" value={form.company ?? ""} onChange={(e) => set("company", e.target.value)} />
            <input className={FIELD} placeholder="موبایل" dir="ltr" value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
            <input className={FIELD} placeholder="ایمیل" dir="ltr" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />
            <input className={FIELD} placeholder="شهر (برای پین نقشه)" value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} />
            <input className={FIELD} placeholder="وب‌سایت" dir="ltr" value={form.websiteUrl ?? ""} onChange={(e) => set("websiteUrl", e.target.value)} />
            <select className={`${FIELD} col-span-2`} value={form.productCode ?? "ERP"} onChange={(e) => set("productCode", e.target.value)}>
              {PRODUCTS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <textarea className={`${FIELD} col-span-2`} rows={3} placeholder="پیام" value={form.message ?? ""} onChange={(e) => set("message", e.target.value)} />
            <div className="col-span-2 flex gap-2">
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await updateResellerApplication(id, {
                      name: form.name ?? undefined,
                      company: form.company ?? undefined,
                      phone: form.phone ?? undefined,
                      email: form.email ?? undefined,
                      city: form.city ?? undefined,
                      websiteUrl: form.websiteUrl ?? undefined,
                      productCode: form.productCode ?? undefined,
                      message: form.message ?? undefined,
                    });
                    setEditing(false);
                    setMsg("ذخیره شد ✓");
                    load();
                    onChanged();
                  })
                }
                className="flex-1 py-2 rounded-lg bg-primary text-white text-[12.5px] font-bold disabled:opacity-50 cursor-pointer"
              >
                ذخیره
              </button>
              <button onClick={() => { setEditing(false); setForm(app); }} className="flex-1 py-2 rounded-lg bg-slate-100 text-ink-soft text-[12.5px] font-bold cursor-pointer">
                انصراف
              </button>
            </div>
          </div>
        ) : (
          <div className="border border-border rounded-xl overflow-hidden text-[12.5px]">
            {[
              ["نام", app.name],
              ["شرکت", app.company],
              ["موبایل", app.phone],
              ["ایمیل", app.email],
              ["شهر", app.city],
              ["وب‌سایت", app.websiteUrl],
              ["محصول", PRODUCTS.find((p) => p.value === app.productCode)?.label ?? app.productCode],
              ["پیام", app.message],
              ["تاریخ ثبت", new Date(app.createdAt).toLocaleDateString("fa-IR")],
              ...(app.reviewedAt ? [["تاریخ بررسی", `${new Date(app.reviewedAt).toLocaleDateString("fa-IR")}${app.reviewedBy?.name ? ` — ${app.reviewedBy.name}` : ""}`]] : []),
              ...(app.rejectionNote ? [["دلیل رد", app.rejectionNote]] : []),
            ].map(([label, value]) => (
              <div key={label as string} className="flex border-b border-border last:border-b-0">
                <div className="w-[100px] shrink-0 bg-slate-50 text-[11.5px] font-bold text-muted px-3 py-2.5">{label}</div>
                <div className="flex-1 px-3 py-2.5 whitespace-pre-wrap">{(value as string) || "—"}</div>
              </div>
            ))}
          </div>
        )}

        {msg && <div className="text-[12.5px] text-success font-semibold">{msg}</div>}
        {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}

        {rejecting && (
          <div className="flex gap-2">
            <input className={FIELD} placeholder="دلیل رد (اختیاری)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button
              disabled={busy}
              onClick={() => run(async () => { await rejectResellerApplication(id, note.trim() || undefined); onChanged(); onClose(); })}
              className="shrink-0 px-4 rounded-lg bg-danger text-white text-[12.5px] font-bold disabled:opacity-50 cursor-pointer"
            >
              ثبت رد
            </button>
          </div>
        )}

        {!editing && (
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setEditing(true)} className="text-[12px] font-bold text-ink-soft bg-slate-100 px-3 py-2 rounded-lg cursor-pointer">ویرایش</button>
            {pending && (
              <>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const res = await approveResellerApplication(id);
                      setMsg(
                        `تأیید شد. پروفایل همکار ساخته شد${res.pinnedOnMap ? " و روی نقشه پین شد" : " (شهر ثبت نشده؛ بعد از ثبت شهر روی نقشه می‌آید)"}. ${
                          res.accessGranted ? "پیامک ورود برای او ارسال شد تا عکس و اطلاعاتش را کامل کند." : `دسترسی ورود خودکار ساخته نشد: ${res.accessError ?? ""}`
                        }`,
                      );
                      load();
                      onChanged();
                    })
                  }
                  className="text-[12px] font-bold text-white bg-success px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50"
                >
                  تأیید و ساخت پروفایل
                </button>
                <button onClick={() => setRejecting((v) => !v)} className="text-[12px] font-bold text-danger bg-danger-soft px-3 py-2 rounded-lg cursor-pointer">رد</button>
              </>
            )}
            {app.status !== "APPROVED" && (
              <button
                disabled={busy}
                onClick={() => {
                  if (window.confirm("این درخواست برای همیشه حذف شود؟")) run(async () => { await deleteResellerApplication(id); onChanged(); onClose(); });
                }}
                className="text-[12px] font-bold text-danger px-3 py-2 rounded-lg cursor-pointer mr-auto disabled:opacity-50"
              >
                حذف
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
