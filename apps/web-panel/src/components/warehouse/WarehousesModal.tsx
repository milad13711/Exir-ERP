import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { PlusIcon } from "@/components/icons";
import { toPersianDigits } from "@/lib/persian";
import {
  fetchWarehouses,
  createWarehouse,
  updateWarehouse,
  setDefaultWarehouse,
  deleteWarehouse,
  type Warehouse,
} from "@/lib/api";
import { ExcelImportExportBar } from "@/components/shared/ExcelImportExportBar";

const inputClass =
  "text-[12.5px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-lg px-2.5 py-2 focus:border-primary transition-colors";

export function WarehousesModal({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const [warehouses, setWarehouses] = useState<Warehouse[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);

  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editAddress, setEditAddress] = useState("");

  function reload() {
    fetchWarehouses().then(setWarehouses).catch(() => setWarehouses([]));
  }
  useEffect(reload, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createWarehouse({ name: name.trim(), code: code.trim() || undefined, address: address.trim() || undefined });
      setName("");
      setCode("");
      setAddress("");
      setAddOpen(false);
      reload();
      onChanged?.();
    } finally {
      setSaving(false);
    }
  }

  function startEdit(w: Warehouse) {
    setEditingId(w.id);
    setEditName(w.name);
    setEditCode(w.code ?? "");
    setEditAddress(w.address ?? "");
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    setBusyId(id);
    try {
      await updateWarehouse(id, {
        name: editName.trim(),
        code: editCode.trim() || undefined,
        address: editAddress.trim() || undefined,
      });
      setEditingId(null);
      reload();
      onChanged?.();
    } finally {
      setBusyId(null);
    }
  }

  async function handleSetDefault(id: string) {
    setBusyId(id);
    try {
      await setDefaultWarehouse(id);
      reload();
      onChanged?.();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("این انبار حذف شود؟")) return;
    setBusyId(id);
    try {
      await deleteWarehouse(id);
      reload();
      onChanged?.();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "حذف انبار ناموفق بود");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal title="انبارها" onClose={onClose} width="max-w-[560px]">
      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => setAddOpen((v) => !v)}
          className="self-start flex items-center gap-1.5 text-[12px] font-bold text-primary bg-primary-soft px-3 py-2 rounded-lg cursor-pointer"
        >
          <PlusIcon className="w-3.5 h-3.5" />
          انبار جدید
        </button>

        {addOpen ? (
          <form onSubmit={handleAdd} className="flex flex-col gap-2.5 bg-slate-50 border border-border rounded-xl p-3.5">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="نام انبار (الزامی)" className={inputClass} />
            <div className="flex gap-2.5">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="کد (اختیاری)" dir="ltr" className={`${inputClass} flex-1`} />
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="آدرس (اختیاری)" className={`${inputClass} flex-1`} />
            </div>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="self-end text-[12px] font-bold text-white bg-primary px-3.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
            >
              {saving ? "در حال ثبت..." : "ثبت"}
            </button>
          </form>
        ) : null}

        <ExcelImportExportBar
          exportPath="/warehouse/warehouses/export"
          exportFilename="warehouses.xlsx"
          importPath="/warehouse/warehouses/import"
          templatePath="/warehouse/warehouses/template"
          templateFilename="warehouses-template.xlsx"
          onImported={() => {
            reload();
            onChanged?.();
          }}
        />

        <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto">
          {warehouses === null ? (
            <div className="py-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : warehouses.length === 0 ? (
            <div className="py-8 text-center text-muted text-sm">انباری ثبت نشده است</div>
          ) : (
            warehouses.map((w) => (
              <div key={w.id} className="bg-slate-50 border border-border rounded-xl p-3.5">
                {editingId === w.id ? (
                  <div className="flex flex-col gap-2.5">
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} className={`${inputClass} bg-surface`} />
                    <div className="flex gap-2.5">
                      <input value={editCode} onChange={(e) => setEditCode(e.target.value)} placeholder="کد" dir="ltr" className={`${inputClass} bg-surface flex-1`} />
                      <input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} placeholder="آدرس" className={`${inputClass} bg-surface flex-1`} />
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button type="button" onClick={() => setEditingId(null)} className="text-[11.5px] font-bold text-ink-soft bg-slate-100 px-3 py-1.5 rounded-lg cursor-pointer">
                        انصراف
                      </button>
                      <button
                        type="button"
                        onClick={() => saveEdit(w.id)}
                        disabled={busyId === w.id || !editName.trim()}
                        className="text-[11.5px] font-bold text-white bg-primary px-3.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                      >
                        ذخیره
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-bold truncate">{w.name}</span>
                        {w.isDefault ? <Badge tone="primary">پیش‌فرض</Badge> : null}
                        {!w.isActive ? <Badge tone="neutral">غیرفعال</Badge> : null}
                      </div>
                      <div className="text-[11.5px] text-muted mt-0.5 truncate">
                        {[w.code, w.address].filter(Boolean).join(" · ") || "—"} · موجودی: {toPersianDigits(w.stockOnHand)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {!w.isDefault ? (
                        <button
                          type="button"
                          onClick={() => handleSetDefault(w.id)}
                          disabled={busyId === w.id}
                          className="text-[11px] font-bold text-accent bg-accent-soft px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                        >
                          پیش‌فرض کن
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => startEdit(w)}
                        className="text-[11px] font-bold text-primary bg-primary-soft px-2.5 py-1.5 rounded-lg cursor-pointer"
                      >
                        ویرایش
                      </button>
                      {!w.isDefault ? (
                        <button
                          type="button"
                          onClick={() => handleDelete(w.id)}
                          disabled={busyId === w.id}
                          className="text-[11px] font-bold text-danger bg-danger-soft px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                        >
                          حذف
                        </button>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
