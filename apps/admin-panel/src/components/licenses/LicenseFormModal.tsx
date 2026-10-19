import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { BTN_PRIMARY, INPUT, LABEL, SELECT } from "@/components/ui/styles";
import { fetchCatalogModules, fetchTenants, type CatalogModule, type AdminTenant } from "@/lib/api";
import { createLicense, updateLicense, type LicenseRow } from "@/lib/licenses-api";
import { errMsg } from "./shared";

/** ساخت یا ویرایش لایسنس. کلید لایسنس خودکار ساخته می‌شود و هرگز قابل ویرایش نیست. تاریخ انقضا خالی = دائمی. */
export function LicenseFormModal({ license, onClose, onSaved }: { license?: LicenseRow; onClose: () => void; onSaved: (created?: LicenseRow) => void }) {
  const editing = !!license;
  const [orgName, setOrgName] = useState(license?.orgName ?? "");
  const [productName, setProductName] = useState(license?.productName ?? "exir-erp");
  const [edition, setEdition] = useState(license?.edition ?? "");
  const [customerName, setCustomerName] = useState(license?.customerName ?? "");
  const [customerEmail, setCustomerEmail] = useState(license?.customerEmail ?? "");
  const [notes, setNotes] = useState(license?.notes ?? "");
  const [seats, setSeats] = useState(license?.seats ?? 10);
  const [maxActivations, setMaxActivations] = useState(license?.maxActivations ?? 1);
  const [graceDays, setGraceDays] = useState(license?.graceDays ?? 14);
  const [integrityPolicy, setIntegrityPolicy] = useState<"WARN" | "LOCK">(license?.integrityPolicy ?? "WARN");
  const [expiresAt, setExpiresAt] = useState("");
  const [updatesUntil, setUpdatesUntil] = useState("");
  const [tenantId, setTenantId] = useState(license?.tenantId ?? "");
  const [modules, setModules] = useState<CatalogModule[]>([]);
  const [selected, setSelected] = useState<string[]>(license?.allowedModules ?? []);
  const [tenants, setTenants] = useState<AdminTenant[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCatalogModules().then(setModules).catch(() => undefined);
    fetchTenants().then(setTenants).catch(() => undefined);
  }, []);

  const toggle = (code: string) => setSelected((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!orgName.trim() || selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      if (editing && license) {
        await updateLicense(license.id, {
          orgName: orgName.trim(), productName, edition, customerName, customerEmail, notes,
          modules: selected, seats, maxActivations, graceDays, integrityPolicy, tenantId: tenantId || undefined,
        });
        onSaved();
      } else {
        const created = await createLicense({
          orgName: orgName.trim(), productName, edition: edition || undefined, customerName: customerName || undefined,
          customerEmail: customerEmail || undefined, notes: notes || undefined, modules: selected, seats, maxActivations, graceDays, integrityPolicy,
          tenantId: tenantId || undefined, expiresAt: expiresAt || undefined, updatesUntil: updatesUntil || undefined,
        });
        onSaved(created);
      }
      onClose();
    } catch (err) {
      setError(errMsg(err, "ذخیره‌ی لایسنس ناموفق بود"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={editing ? "ویرایش لایسنس" : "صدور لایسنس جدید"} onClose={onClose} width="max-w-[640px]">
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        {editing && license?.licenseKey ? (
          <div>
            <label className={LABEL}>کلید لایسنس (غیرقابل ویرایش)</label>
            <input readOnly dir="ltr" value={license.licenseKey} className={`${INPUT} font-mono text-left`} />
          </div>
        ) : null}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>نام سازمان</label>
            <input value={orgName} onChange={(e) => setOrgName(e.target.value)} required className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>محصول</label>
            <input dir="ltr" value={productName} onChange={(e) => setProductName(e.target.value)} className={`${INPUT} text-left`} />
          </div>
          <div>
            <label className={LABEL}>نسخه / پلن (اختیاری)</label>
            <input value={edition} onChange={(e) => setEdition(e.target.value)} placeholder="مثلاً enterprise" className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>تننت مرتبط (اختیاری)</label>
            <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} className={`${SELECT} w-full`}>
              <option value="">بدون تننت مشخص</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL}>نام مشتری</label>
            <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>ایمیل مشتری</label>
            <input dir="ltr" type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} className={`${INPUT} text-left`} />
          </div>
          <div>
            <label className={LABEL}>سقف کاربر</label>
            <input type="number" min={1} value={seats} onChange={(e) => setSeats(Number(e.target.value))} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>سقف فعال‌سازی هم‌زمان (۰ = نامحدود)</label>
            <input type="number" min={0} value={maxActivations} onChange={(e) => setMaxActivations(Number(e.target.value))} className={INPUT} />
          </div>
          {!editing ? (
            <>
              <div>
                <label className={LABEL}>انقضای لایسنس (خالی = دائمی)</label>
                <JalaliDateInput value={expiresAt} onChange={setExpiresAt} placeholder="دائمی (بدون انقضا)" />
              </div>
              <div>
                <label className={LABEL}>حق به‌روزرسانی/پشتیبانی تا (خالی = نامحدود)</label>
                <JalaliDateInput value={updatesUntil} onChange={setUpdatesUntil} placeholder="نامحدود" />
              </div>
            </>
          ) : null}
          <div>
            <label className={LABEL}>مهلت اضافه آفلاین/پس از انقضا (روز)</label>
            <input type="number" min={0} max={365} value={graceDays} onChange={(e) => setGraceDays(Number(e.target.value))} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>واکنش به دستکاری کد</label>
            <select value={integrityPolicy} onChange={(e) => setIntegrityPolicy(e.target.value as "WARN" | "LOCK")} className={`${SELECT} w-full`}>
              <option value="WARN">هشدار و گزارش (پیش‌فرض، امن)</option>
              <option value="LOCK">قفل کردن سامانه</option>
            </select>
          </div>
        </div>
        {editing ? <p className="text-[11.5px] text-muted">برای تغییر انقضا از «تمدید» استفاده کنید تا در ردپای عملیات ثبت شود.</p> : null}

        <div>
          <label className={LABEL}>ماژول‌های مجاز (وابستگی‌ها خودکار اضافه می‌شوند)</label>
          <div className="flex flex-wrap gap-1.5 max-h-[170px] overflow-y-auto border border-border rounded-xl p-2.5">
            {modules.map((m) => {
              const on = selected.includes(m.code);
              return (
                <button type="button" key={m.code} onClick={() => toggle(m.code)}
                  className={`text-[11.5px] font-semibold px-3 py-1.5 rounded-lg cursor-pointer border ${on ? "bg-primary text-white border-primary" : "bg-surface border-border text-ink-soft"}`}>
                  {m.name}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className={LABEL}>یادداشت داخلی</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={INPUT} />
        </div>
        {error ? <div className="text-[12px] text-danger">{error}</div> : null}
        <button type="submit" disabled={busy || !orgName.trim() || selected.length === 0} className={`${BTN_PRIMARY} w-full`}>
          {busy ? "در حال ذخیره..." : editing ? "ذخیره" : "صدور لایسنس"}
        </button>
      </form>
    </Modal>
  );
}
