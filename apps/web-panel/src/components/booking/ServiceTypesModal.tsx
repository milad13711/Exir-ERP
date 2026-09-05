import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PlusIcon } from "@/components/icons";
import { formatToman } from "@/lib/persian";
import {
  fetchServiceTypes,
  createServiceType,
  updateServiceType,
  deactivateServiceType,
  type ServiceType,
} from "@/lib/api";

const inputClass =
  "text-[12.5px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-lg px-2.5 py-2 focus:border-primary transition-colors";

export function ServiceTypesModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [items, setItems] = useState<ServiceType[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [duration, setDuration] = useState("30");
  const [price, setPrice] = useState("0");
  const [requiresDeposit, setRequiresDeposit] = useState(false);
  const [depositAmount, setDepositAmount] = useState("0");
  const [requiresCoordination, setRequiresCoordination] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  function reload() {
    fetchServiceTypes(true).then(setItems).catch(() => setItems([]));
  }
  useEffect(reload, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !duration) return;
    setSaving(true);
    try {
      await createServiceType({
        name: name.trim(),
        durationMinutes: Number(duration),
        price: Number(price) || 0,
        requiresDeposit,
        depositAmount: requiresDeposit ? Number(depositAmount) || 0 : undefined,
        requiresCoordination,
      });
      setName("");
      setDuration("30");
      setPrice("0");
      setRequiresDeposit(false);
      setDepositAmount("0");
      setRequiresCoordination(false);
      setAddOpen(false);
      reload();
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(s: ServiceType) {
    setBusyId(s.id);
    try {
      if (s.isActive) {
        await deactivateServiceType(s.id);
      } else {
        await updateServiceType(s.id, { isActive: true });
      }
      reload();
      onChanged();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "تغییر وضعیت ناموفق بود");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal title="انواع خدمت" onClose={onClose} width="max-w-[520px]">
      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => setAddOpen((v) => !v)}
          className="self-start flex items-center gap-1.5 text-[12px] font-bold text-primary bg-primary-soft px-3 py-2 rounded-lg cursor-pointer"
        >
          <PlusIcon className="w-3.5 h-3.5" />
          نوع خدمت جدید
        </button>

        {addOpen ? (
          <form onSubmit={handleAdd} className="flex flex-col gap-2.5 bg-slate-50 border border-border rounded-xl p-3.5">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="نام خدمت" className={inputClass} />
            <div className="flex gap-2.5">
              <input
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                type="number"
                min={5}
                placeholder="مدت‌زمان (دقیقه)"
                className={`${inputClass} flex-1`}
              />
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                type="number"
                min={0}
                placeholder="قیمت (تومان)"
                className={`${inputClass} flex-1`}
              />
            </div>
            <label className="flex items-center gap-2 text-[12px] font-semibold text-ink-soft cursor-pointer">
              <input type="checkbox" checked={requiresCoordination} onChange={(e) => setRequiresCoordination(e.target.checked)} />
              نیاز به هماهنگی اولیه با ارائه‌دهنده قبل از نهایی‌شدن رزرو
            </label>
            <label className="flex items-center gap-2 text-[12px] font-semibold text-ink-soft cursor-pointer">
              <input type="checkbox" checked={requiresDeposit} onChange={(e) => setRequiresDeposit(e.target.checked)} />
              نیاز به پرداخت بیعانه/پیش‌پرداخت
            </label>
            {requiresDeposit && (
              <input
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                type="number"
                min={0}
                placeholder="مبلغ بیعانه (تومان)"
                className={inputClass}
              />
            )}
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="self-end text-[12px] font-bold text-white bg-primary px-3.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
            >
              {saving ? "در حال ثبت..." : "ثبت"}
            </button>
          </form>
        ) : null}

        <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto">
          {items === null ? (
            <div className="py-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center text-muted text-sm">نوع خدمتی ثبت نشده</div>
          ) : (
            items.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 bg-slate-50 border border-border rounded-xl p-3.5">
                <div className="min-w-0">
                  <div className="text-[13px] font-bold truncate">{s.name}</div>
                  <div className="text-[11.5px] text-muted mt-0.5">
                    {s.durationMinutes} دقیقه · {formatToman(s.price)}
                    {s.requiresCoordination ? " · نیاز به هماهنگی" : ""}
                    {s.requiresDeposit ? ` · بیعانه ${formatToman(s.depositAmount ?? 0)}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleActive(s)}
                  disabled={busyId === s.id}
                  className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg cursor-pointer shrink-0 disabled:opacity-50 ${
                    s.isActive ? "text-danger bg-danger-soft" : "text-success bg-success-soft"
                  }`}
                >
                  {s.isActive ? "غیرفعال‌سازی" : "فعال‌سازی"}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
