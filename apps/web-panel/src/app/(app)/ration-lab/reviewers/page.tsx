"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
  fetchRationLabReviewers,
  createRationLabReviewer,
  updateRationLabReviewer,
  deleteRationLabReviewer,
  fetchRationDiscountCodes,
  createRationDiscountCode,
  deactivateRationDiscountCode,
  ApiError,
  type RationLabReviewer,
  type RationDiscountCode,
} from "@/lib/api";

export default function RationLabReviewersPage() {
  const [reviewers, setReviewers] = useState<RationLabReviewer[] | null>(null);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [codes, setCodes] = useState<RationDiscountCode[] | null>(null);
  const [newCode, setNewCode] = useState("");
  const [newPercent, setNewPercent] = useState("100");
  const [codeError, setCodeError] = useState<string | null>(null);

  function reload() {
    fetchRationLabReviewers().then(setReviewers).catch(() => setReviewers([]));
    fetchRationDiscountCodes().then(setCodes).catch(() => setCodes([]));
  }
  useEffect(reload, []);

  async function handleAddCode() {
    setCodeError(null);
    if (!newCode.trim() || !newPercent) return setCodeError("کد و درصد تخفیف لازم است");
    try {
      await createRationDiscountCode({ code: newCode.trim(), percentOff: Number(newPercent) });
      setNewCode("");
      setNewPercent("100");
      reload();
    } catch (err) {
      setCodeError(err instanceof ApiError ? err.message : "افزودن کد با خطا مواجه شد");
    }
  }

  async function handleAdd() {
    setError(null);
    if (!phone.trim() || !name.trim()) return setError("شماره و نام لازم است");
    setSubmitting(true);
    try {
      await createRationLabReviewer({ phone: phone.trim(), name: name.trim() });
      setPhone("");
      setName("");
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "افزودن با خطا مواجه شد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-5 lg:p-7 max-w-[720px] mx-auto">
      <h1 className="text-xl font-extrabold">کارشناسان آزمایشگاه</h1>
      <p className="text-[13.5px] text-muted mt-1">
        فقط شماره‌های ثبت‌شده در این لیست می‌توانند از پورتال عمومی آزمایشگاه وارد شوند.
      </p>

      <Card className="mt-6 p-5">
        <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="شماره موبایل"
            dir="ltr"
            className="px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none text-[13px]"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="نام کارشناس"
            className="px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none text-[13px]"
          />
          <button
            onClick={handleAdd}
            disabled={submitting}
            className="px-5 py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold disabled:opacity-50"
          >
            افزودن
          </button>
        </div>
        {error ? <div className="text-[12.5px] text-danger font-semibold mt-2">{error}</div> : null}
      </Card>

      <Card className="mt-4 p-2">
        {reviewers === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : reviewers.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">هنوز کارشناسی ثبت نشده است</div>
        ) : (
          reviewers.map((r, i) => (
            <div
              key={r.id}
              className={`flex items-center justify-between gap-3 px-4 py-3.5 ${i < reviewers.length - 1 ? "border-b border-border" : ""}`}
            >
              <div>
                <div className="text-[13px] font-bold">{r.name}</div>
                <div className="text-[11.5px] text-muted" dir="ltr">
                  {r.phone}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={r.isActive ? "success" : "neutral"}>{r.isActive ? "فعال" : "غیرفعال"}</Badge>
                <button
                  onClick={async () => {
                    await updateRationLabReviewer(r.id, { isActive: !r.isActive });
                    reload();
                  }}
                  className="text-[12px] font-bold text-primary"
                >
                  {r.isActive ? "غیرفعال کن" : "فعال کن"}
                </button>
                <button
                  onClick={async () => {
                    await deleteRationLabReviewer(r.id);
                    reload();
                  }}
                  className="text-[12px] font-bold text-danger"
                >
                  حذف
                </button>
              </div>
            </div>
          ))
        )}
      </Card>

      <h2 className="text-[16px] font-extrabold mt-8">کدهای تخفیف هزینه‌ی آنالیز</h2>
      <p className="text-[12.5px] text-muted mt-1">مثلاً کدی با ۱۰۰٪ تخفیف برای آنالیز کاملاً رایگان.</p>

      <Card className="mt-4 p-5">
        <div className="grid sm:grid-cols-[1fr_100px_auto] gap-2">
          <input
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            placeholder="کد تخفیف"
            dir="ltr"
            className="px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none text-[13px]"
          />
          <input
            value={newPercent}
            onChange={(e) => setNewPercent(e.target.value)}
            placeholder="درصد"
            dir="ltr"
            className="px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none text-[13px]"
          />
          <button onClick={handleAddCode} className="px-5 py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold">
            افزودن
          </button>
        </div>
        {codeError ? <div className="text-[12.5px] text-danger font-semibold mt-2">{codeError}</div> : null}
      </Card>

      <Card className="mt-4 p-2">
        {codes === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : codes.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">هنوز کد تخفیفی ثبت نشده است</div>
        ) : (
          codes.map((c, i) => (
            <div
              key={c.id}
              className={`flex items-center justify-between gap-3 px-4 py-3.5 ${i < codes.length - 1 ? "border-b border-border" : ""}`}
            >
              <div>
                <div className="text-[13px] font-bold" dir="ltr">
                  {c.code}
                </div>
                <div className="text-[11.5px] text-muted">
                  {c.percentOff}٪ تخفیف · استفاده‌شده {c.redemptionCount} بار
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={c.isActive ? "success" : "neutral"}>{c.isActive ? "فعال" : "غیرفعال"}</Badge>
                {c.isActive ? (
                  <button
                    onClick={async () => {
                      await deactivateRationDiscountCode(c.id);
                      reload();
                    }}
                    className="text-[12px] font-bold text-danger"
                  >
                    غیرفعال کن
                  </button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
