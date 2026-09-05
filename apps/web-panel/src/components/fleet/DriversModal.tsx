import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { PlusIcon, TrashIcon } from "@/components/icons";
import { fetchDrivers, createDriver, updateDriver, deactivateDriver, type Driver } from "@/lib/api";

const inputClass =
  "w-full text-[12.5px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-lg px-2.5 py-2 focus:border-primary transition-colors";
const labelClass = "text-[11px] font-semibold text-ink-soft mb-1 block";

function DriverForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Driver;
  onSave: (data: Parameters<typeof createDriver>[0]) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [vehicleType, setVehicleType] = useState(initial?.vehicleType ?? "");
  const [plateNumber, setPlateNumber] = useState(initial?.plateNumber ?? "");
  const [capacityKg, setCapacityKg] = useState(initial?.capacityKg?.toString() ?? "");
  const [serviceAreas, setServiceAreas] = useState(initial?.serviceAreas.join("، ") ?? "");
  const [availableHoursNote, setAvailableHoursNote] = useState(initial?.availableHoursNote ?? "");
  const [reliabilityNote, setReliabilityNote] = useState(initial?.reliabilityNote ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        phone: phone.trim(),
        vehicleType: vehicleType.trim() || undefined,
        plateNumber: plateNumber.trim() || undefined,
        capacityKg: capacityKg ? Number(capacityKg) : undefined,
        serviceAreas: serviceAreas
          .split(/[،,]/)
          .map((s) => s.trim())
          .filter(Boolean),
        availableHoursNote: availableHoursNote.trim() || undefined,
        reliabilityNote: reliabilityNote.trim() || undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2.5 bg-slate-50 border border-border rounded-xl p-3.5">
      <div className="flex gap-2.5">
        <div className="flex-1">
          <label className={labelClass}>نام راننده</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </div>
        <div className="flex-1">
          <label className={labelClass}>شماره تماس</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ""))} dir="ltr" className={inputClass} />
        </div>
      </div>
      <div className="flex gap-2.5">
        <div className="flex-1">
          <label className={labelClass}>نوع ماشین</label>
          <input value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} className={inputClass} />
        </div>
        <div className="flex-1">
          <label className={labelClass}>پلاک</label>
          <input value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} dir="ltr" className={inputClass} />
        </div>
        <div className="flex-1">
          <label className={labelClass}>ظرفیت بار (کیلوگرم)</label>
          <input value={capacityKg} onChange={(e) => setCapacityKg(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" className={inputClass} />
        </div>
      </div>
      <div>
        <label className={labelClass}>محدوده‌های سرویس‌دهی (با ویرگول جدا کنید)</label>
        <input value={serviceAreas} onChange={(e) => setServiceAreas(e.target.value)} placeholder="تهران، کرج" className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>ساعات معمول در دسترس بودن</label>
        <input value={availableHoursNote} onChange={(e) => setAvailableHoursNote(e.target.value)} placeholder="مثلاً ۸ تا ۲۰" className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>یادداشت اخلاقی و اعتبار</label>
        <textarea value={reliabilityNote} onChange={(e) => setReliabilityNote(e.target.value)} rows={2} className={inputClass} />
      </div>
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="text-[11.5px] font-bold text-ink-soft bg-slate-100 px-3 py-1.5 rounded-lg cursor-pointer">
          انصراف
        </button>
        <button
          type="submit"
          disabled={saving || !name.trim() || !phone.trim()}
          className="text-[11.5px] font-bold text-white bg-primary px-3.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
        >
          ذخیره
        </button>
      </div>
    </form>
  );
}

export function DriversModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [drivers, setDrivers] = useState<Driver[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function reload() {
    fetchDrivers().then(setDrivers).catch(() => setDrivers([]));
  }
  useEffect(reload, []);

  async function handleCreate(data: Parameters<typeof createDriver>[0]) {
    await createDriver(data);
    setAddOpen(false);
    reload();
    onChanged();
  }

  async function handleUpdate(id: string, data: Parameters<typeof createDriver>[0]) {
    await updateDriver(id, data);
    setEditingId(null);
    reload();
    onChanged();
  }

  async function handleDeactivate(id: string) {
    if (!window.confirm("این راننده غیرفعال شود؟")) return;
    setBusyId(id);
    try {
      await deactivateDriver(id);
      reload();
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal title="راننده‌ها" onClose={onClose} width="max-w-[600px]">
      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => setAddOpen((v) => !v)}
          className="self-start flex items-center gap-1.5 text-[12px] font-bold text-primary bg-primary-soft px-3 py-2 rounded-lg cursor-pointer"
        >
          <PlusIcon className="w-3.5 h-3.5" />
          راننده جدید
        </button>

        {addOpen ? <DriverForm onSave={handleCreate} onCancel={() => setAddOpen(false)} /> : null}

        <div className="flex flex-col gap-2 max-h-[440px] overflow-y-auto">
          {drivers === null ? (
            <div className="py-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : drivers.length === 0 ? (
            <div className="py-8 text-center text-muted text-sm">راننده‌ای ثبت نشده</div>
          ) : (
            drivers.map((d) =>
              editingId === d.id ? (
                <DriverForm key={d.id} initial={d} onSave={(data) => handleUpdate(d.id, data)} onCancel={() => setEditingId(null)} />
              ) : (
                <div key={d.id} className="flex items-center justify-between gap-3 bg-slate-50 border border-border rounded-xl p-3.5">
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold truncate flex items-center gap-2">
                      {d.name}
                      {!d.isActive && <Badge tone="danger">غیرفعال</Badge>}
                      {d.averageRating != null && <Badge tone="success">امتیاز {d.averageRating}</Badge>}
                    </div>
                    <div className="text-[11px] text-muted mt-0.5" dir="ltr">
                      {d.phone}
                      {d.plateNumber ? ` · ${d.plateNumber}` : ""}
                    </div>
                    {d.serviceAreas.length > 0 && (
                      <div className="text-[10.5px] text-muted mt-0.5">محدوده: {d.serviceAreas.join("، ")}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setEditingId(d.id)}
                      className="text-[11px] font-bold text-primary bg-primary-soft px-2.5 py-1.5 rounded-lg cursor-pointer"
                    >
                      ویرایش
                    </button>
                    {d.isActive && (
                      <button
                        type="button"
                        onClick={() => handleDeactivate(d.id)}
                        disabled={busyId === d.id}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:bg-danger-soft hover:text-danger cursor-pointer disabled:opacity-50"
                        aria-label="غیرفعال‌سازی"
                      >
                        <TrashIcon className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ),
            )
          )}
        </div>
      </div>
    </Modal>
  );
}
