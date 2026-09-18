import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { formatToman, toPersianDigits } from "@/lib/persian";
import {
  fetchReseller,
  fetchResellerConversions,
  linkResellerConversion,
  fetchResellerCommissions,
  fetchCrmContacts,
  updateReseller,
  grantResellerAccess,
  ApiError,
  type Reseller,
  type ReferralConversion,
  type ReferralCommission,
  type ResellerTier,
  type CrmContact,
} from "@/lib/api";

const inputClass =
  "w-full text-[12.5px] outline-none bg-slate-50 border border-border rounded-lg px-3 py-2 focus:border-primary transition-colors";
const TIER_LABELS: Record<ResellerTier, string> = { A_PLUS: "A+", A: "A", B: "B" };
const SIGNUP_BASE_URL = process.env.NEXT_PUBLIC_SIGNUP_URL ?? "https://exirerp.ir/signup";

export function ResellerDetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [reseller, setReseller] = useState<Reseller | null>(null);
  const [conversions, setConversions] = useState<ReferralConversion[] | null>(null);
  const [commissions, setCommissions] = useState<ReferralCommission[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingCustomer, setAddingCustomer] = useState(false);

  function reload() {
    fetchReseller(id).then(setReseller).catch(() => setReseller(null));
    fetchResellerConversions(id).then(setConversions).catch(() => setConversions([]));
    fetchResellerCommissions(id).then(setCommissions).catch(() => setCommissions([]));
  }
  useEffect(reload, [id]);

  async function handlePatch(data: Parameters<typeof updateReseller>[1]) {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateReseller(id, data);
      setReseller(updated);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ذخیره ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  async function handleGrantAccess() {
    setSaving(true);
    setError(null);
    try {
      const updated = await grantResellerAccess(id);
      setReseller(updated);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "اعطای دسترسی ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  async function handleLinkContact(contactId: string) {
    setSaving(true);
    setError(null);
    try {
      await linkResellerConversion(id, contactId);
      setAddingCustomer(false);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "اتصال مشتری ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  if (!reseller) {
    return (
      <Modal title="نماینده" onClose={onClose} width="max-w-[560px]">
        <div className="py-8 text-center text-muted text-sm">در حال بارگذاری...</div>
      </Modal>
    );
  }

  const referralLink = `${SIGNUP_BASE_URL}?ref=${reseller.referralCode}`;

  return (
    <Modal title={reseller.contact.name} onClose={onClose} width="max-w-[560px]">
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div className="text-[12.5px] text-muted">{reseller.contact.company || "—"} · {reseller.contact.phone || "بدون شماره"}</div>
          {reseller.userId ? (
            <Badge tone="success">دسترسی ورود فعال</Badge>
          ) : (
            <button
              onClick={handleGrantAccess}
              disabled={saving || !reseller.contact.phone}
              className="text-[11.5px] font-bold text-primary bg-primary-soft px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
            >
              اعطای دسترسی ورود
            </button>
          )}
        </div>

        <div className="bg-slate-50 rounded-lg p-3">
          <div className="text-[11px] font-semibold text-ink-soft mb-1.5">لینک معرفی نماینده</div>
          <input readOnly value={referralLink} dir="ltr" onFocus={(e) => e.target.select()} className={inputClass} />
          <div className="text-[10.5px] text-muted mt-1.5">
            هر مشتری‌ای که از این لینک وارد شود خودکار به این نماینده وصل می‌شود. برای مشتریانی که از راه دیگری (تلفنی، حضوری) معرفی شده‌اند، از دکمه‌ی «افزودن مشتری معرفی‌شده» پایین استفاده کنید.
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] font-semibold text-ink-soft mb-1.5">سطح نمایندگی</div>
            <div className="flex gap-1.5">
              {(["A_PLUS", "A", "B"] as ResellerTier[]).map((t) => (
                <button
                  key={t}
                  onClick={() => handlePatch({ tier: t })}
                  disabled={saving}
                  className={`flex-1 text-[11px] font-bold py-1.5 rounded-lg border cursor-pointer ${reseller.tier === t ? "bg-primary text-white border-primary" : "border-border text-ink-soft bg-white"}`}
                >
                  {TIER_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-ink-soft mb-1.5">تیک آبی احراز هویت</div>
            <button
              onClick={() => handlePatch({ isVerified: !reseller.isVerified })}
              disabled={saving}
              className={`w-full text-[11px] font-bold py-1.5 rounded-lg border cursor-pointer ${reseller.isVerified ? "bg-primary text-white border-primary" : "border-border text-ink-soft bg-white"}`}
            >
              {reseller.isVerified ? "احراز شده ✓" : "احراز نشده"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-ink-soft">کمیسیون پرداخت اول (٪)</span>
            <input
              type="number"
              min={0}
              max={100}
              defaultValue={reseller.commissionFirstPaymentPercent}
              onBlur={(e) => handlePatch({ commissionFirstPaymentPercent: Number(e.target.value) })}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-ink-soft">کمیسیون تمدید (٪)</span>
            <input
              type="number"
              min={0}
              max={100}
              defaultValue={reseller.commissionRenewalPercent}
              onBlur={(e) => handlePatch({ commissionRenewalPercent: Number(e.target.value) })}
              className={inputClass}
            />
          </label>
        </div>

        {error ? <div className="text-[12px] text-danger">{error}</div> : null}

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[12.5px] font-bold">مشتریان معرفی‌شده ({toPersianDigits(conversions?.length ?? 0)})</div>
            <button
              onClick={() => setAddingCustomer((v) => !v)}
              className="text-[11px] font-bold text-primary bg-primary-soft px-2.5 py-1 rounded-lg cursor-pointer"
            >
              افزودن مشتری معرفی‌شده
            </button>
          </div>

          {addingCustomer ? (
            <ContactPicker onPick={handleLinkContact} onCancel={() => setAddingCustomer(false)} disabled={saving} />
          ) : null}

          <div className="flex flex-col gap-1.5 max-h-[140px] overflow-y-auto mt-2">
            {conversions === null ? (
              <div className="text-[12px] text-muted">در حال بارگذاری...</div>
            ) : conversions.length === 0 ? (
              <div className="text-[12px] text-muted">هنوز مشتری‌ای معرفی نکرده</div>
            ) : (
              conversions.map((c) => (
                <div key={c.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 text-[12px]">
                  <span className="font-semibold">{c.contact.name}</span>
                  <span className="text-muted">{c.contact.company || c.contact.phone || "—"}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <div className="text-[12.5px] font-bold mb-2">کمیسیون‌ها ({toPersianDigits(commissions?.length ?? 0)})</div>
          <div className="flex flex-col gap-1.5 max-h-[160px] overflow-y-auto">
            {commissions === null ? (
              <div className="text-[12px] text-muted">در حال بارگذاری...</div>
            ) : commissions.length === 0 ? (
              <div className="text-[12px] text-muted">هنوز کمیسیونی ثبت نشده</div>
            ) : (
              commissions.map((c) => {
                const settled = c.purchaseOrder.paidAmount >= c.amount;
                return (
                  <div key={c.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 text-[12px]">
                    <div>
                      <div className="font-semibold">{c.referralConversion.contact.company || c.referralConversion.contact.name}</div>
                      <div className="text-muted text-[11px] mt-0.5">{c.kind === "FIRST_PAYMENT" ? "پرداخت اول" : "تمدید"}</div>
                    </div>
                    <div className="text-left">
                      <div className="font-bold">{formatToman(c.amount)}</div>
                      <Badge tone={settled ? "success" : "warning"} className="mt-1">
                        {settled ? "تسویه‌شده" : "تعهدی"}
                      </Badge>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ContactPicker({
  onPick,
  onCancel,
  disabled,
}: {
  onPick: (contactId: string) => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CrmContact[] | null>(null);

  useEffect(() => {
    if (!q.trim()) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      fetchCrmContacts(q.trim()).then(setResults).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="bg-slate-50 border border-border rounded-lg p-2.5 mb-2">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="نام یا شماره مشتری..."
          className="flex-1 text-[12px] outline-none bg-white border border-border rounded-lg px-2.5 py-1.5"
        />
        <button onClick={onCancel} className="text-[11px] font-bold text-ink-soft px-2 py-1.5 rounded-lg cursor-pointer">
          انصراف
        </button>
      </div>
      {results && results.length > 0 ? (
        <div className="flex flex-col gap-1 mt-2 max-h-[140px] overflow-y-auto">
          {results.map((c) => (
            <button
              key={c.id}
              disabled={disabled}
              onClick={() => onPick(c.id)}
              className="text-right flex items-center justify-between bg-white border border-border rounded-lg px-2.5 py-1.5 text-[12px] cursor-pointer hover:border-primary disabled:opacity-50"
            >
              <span className="font-semibold">{c.name}</span>
              <span className="text-muted">{c.company || c.phone || "—"}</span>
            </button>
          ))}
        </div>
      ) : results && results.length === 0 ? (
        <div className="text-[11.5px] text-muted mt-2">مشتری‌ای پیدا نشد</div>
      ) : null}
    </div>
  );
}
