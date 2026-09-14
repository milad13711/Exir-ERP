import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { issueLicense, fetchCatalogModules, fetchTenants, ApiError, type CatalogModule, type AdminTenant } from "@/lib/api";

export function IssueLicenseModal({ onClose, onIssued }: { onClose: () => void; onIssued: () => void }) {
  const [orgName, setOrgName] = useState("");
  const [modules, setModules] = useState<CatalogModule[]>([]);
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [seats, setSeats] = useState(10);
  const [validityDays, setValidityDays] = useState(365);
  const [tenants, setTenants] = useState<AdminTenant[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCatalogModules().then(setModules);
    fetchTenants().then(setTenants);
  }, []);

  function toggleModule(code: string) {
    setSelectedCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orgName.trim() || selectedCodes.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await issueLicense({
        orgName: orgName.trim(),
        modules: selectedCodes,
        seats,
        validityDays,
        tenantId: tenantId || undefined,
      });
      onIssued();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "صدور لایسنس ناموفق بود");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="صدور لایسنس استقرار اختصاصی" onClose={onClose} width="max-w-[560px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">نام سازمان</label>
          <input
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            required
            className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
          />
        </div>

        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">تننت مرتبط (اختیاری)</label>
          <select
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
          >
            <option value="">بدون تننت مشخص</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.slug})
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">تعداد کاربر (seats)</label>
            <input
              type="number"
              min={1}
              value={seats}
              onChange={(e) => setSeats(Number(e.target.value))}
              className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
            />
          </div>
          <div>
            <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">مدت اعتبار (روز)</label>
            <input
              type="number"
              min={1}
              max={3650}
              value={validityDays}
              onChange={(e) => setValidityDays(Number(e.target.value))}
              className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
            />
          </div>
        </div>

        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">ماژول‌های مجاز</label>
          <div className="flex flex-wrap gap-1.5 max-h-[180px] overflow-y-auto border border-border rounded-xl p-2.5">
            {modules.map((m) => {
              const checked = selectedCodes.includes(m.code);
              return (
                <button
                  type="button"
                  key={m.code}
                  onClick={() => toggleModule(m.code)}
                  className={`text-[11.5px] font-semibold px-3 py-1.5 rounded-lg cursor-pointer border ${
                    checked ? "bg-primary text-white border-primary" : "bg-surface border-border text-ink-soft"
                  }`}
                >
                  {m.name}
                </button>
              );
            })}
          </div>
        </div>

        {error ? <div className="text-[12px] text-danger">{error}</div> : null}
        <button
          type="submit"
          disabled={submitting || !orgName.trim() || selectedCodes.length === 0}
          className="mt-1.5 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {submitting ? "در حال صدور..." : "صدور لایسنس"}
        </button>
      </form>
    </Modal>
  );
}
