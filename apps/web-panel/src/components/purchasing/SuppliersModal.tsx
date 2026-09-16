import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { SearchIcon, PlusIcon, TrashIcon } from "@/components/icons";
import {
  fetchSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  type Supplier,
} from "@/lib/api";
import { ExcelImportExportBar } from "@/components/shared/ExcelImportExportBar";

const inputClass =
  "text-[12.5px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-lg px-2.5 py-2 focus:border-primary transition-colors";

export function SuppliersModal({ onClose }: { onClose: () => void }) {
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);

  const [editName, setEditName] = useState("");
  const [editCompany, setEditCompany] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editAddress, setEditAddress] = useState("");

  function reload() {
    fetchSuppliers(search.trim() || undefined).then(setSuppliers).catch(() => setSuppliers([]));
  }
  useEffect(reload, [search]);

  function resetAddForm() {
    setName("");
    setCompany("");
    setPhone("");
    setEmail("");
    setAddress("");
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createSupplier({
        name: name.trim(),
        company: company.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        address: address.trim() || undefined,
      });
      resetAddForm();
      setAddOpen(false);
      reload();
    } finally {
      setSaving(false);
    }
  }

  function startEdit(s: Supplier) {
    setEditingId(s.id);
    setEditName(s.name);
    setEditCompany(s.company ?? "");
    setEditPhone(s.phone ?? "");
    setEditEmail(s.email ?? "");
    setEditAddress(s.address ?? "");
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    setBusyId(id);
    try {
      await updateSupplier(id, {
        name: editName.trim(),
        company: editCompany.trim() || undefined,
        phone: editPhone.trim() || undefined,
        email: editEmail.trim() || undefined,
        address: editAddress.trim() || undefined,
      });
      setEditingId(null);
      reload();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("این تأمین‌کننده حذف شود؟")) return;
    setBusyId(id);
    try {
      await deleteSupplier(id);
      reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "حذف تأمین‌کننده ناموفق بود");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal title="تأمین‌کنندگان" onClose={onClose} width="max-w-[560px]">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon className="w-4 h-4 text-muted absolute top-1/2 -translate-y-1/2 right-3" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="جستجو..."
              className={`${inputClass} w-full pr-9`}
            />
          </div>
          <button
            type="button"
            onClick={() => setAddOpen((v) => !v)}
            className="flex items-center gap-1.5 text-[12px] font-bold text-primary bg-primary-soft px-3 py-2 rounded-lg cursor-pointer shrink-0"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            تأمین‌کننده جدید
          </button>
        </div>

        <ExcelImportExportBar
          exportPath="/purchasing/suppliers/export"
          exportFilename="suppliers.xlsx"
          importPath="/purchasing/suppliers/import"
          templatePath="/purchasing/suppliers/template"
          templateFilename="suppliers-template.xlsx"
          onImported={reload}
        />

        {addOpen ? (
          <form onSubmit={handleAdd} className="flex flex-col gap-2.5 bg-slate-50 border border-border rounded-xl p-3.5">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="نام (الزامی)" className={inputClass} />
            <div className="flex gap-2.5">
              <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="شرکت" className={`${inputClass} flex-1`} />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="تلفن" dir="ltr" className={`${inputClass} flex-1`} />
            </div>
            <div className="flex gap-2.5">
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ایمیل" dir="ltr" className={`${inputClass} flex-1`} />
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="آدرس" className={`${inputClass} flex-1`} />
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

        <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto">
          {suppliers === null ? (
            <div className="py-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : suppliers.length === 0 ? (
            <div className="py-8 text-center text-muted text-sm">تأمین‌کننده‌ای یافت نشد</div>
          ) : (
            suppliers.map((s) => (
              <div key={s.id} className="bg-slate-50 border border-border rounded-xl p-3.5">
                {editingId === s.id ? (
                  <div className="flex flex-col gap-2.5">
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} className={`${inputClass} bg-surface`} />
                    <div className="flex gap-2.5">
                      <input value={editCompany} onChange={(e) => setEditCompany(e.target.value)} placeholder="شرکت" className={`${inputClass} bg-surface flex-1`} />
                      <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="تلفن" dir="ltr" className={`${inputClass} bg-surface flex-1`} />
                    </div>
                    <div className="flex gap-2.5">
                      <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="ایمیل" dir="ltr" className={`${inputClass} bg-surface flex-1`} />
                      <input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} placeholder="آدرس" className={`${inputClass} bg-surface flex-1`} />
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button type="button" onClick={() => setEditingId(null)} className="text-[11.5px] font-bold text-ink-soft bg-slate-100 px-3 py-1.5 rounded-lg cursor-pointer">
                        انصراف
                      </button>
                      <button
                        type="button"
                        onClick={() => saveEdit(s.id)}
                        disabled={busyId === s.id || !editName.trim()}
                        className="text-[11.5px] font-bold text-white bg-primary px-3.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                      >
                        ذخیره
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold truncate">{s.name}</div>
                      <div className="text-[11.5px] text-muted mt-0.5 truncate">
                        {[s.company, s.phone, s.email].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => startEdit(s)}
                        className="text-[11px] font-bold text-primary bg-primary-soft px-2.5 py-1.5 rounded-lg cursor-pointer"
                      >
                        ویرایش
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(s.id)}
                        disabled={busyId === s.id}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:bg-danger-soft hover:text-danger cursor-pointer disabled:opacity-50"
                        aria-label="حذف تأمین‌کننده"
                      >
                        <TrashIcon className="w-3.5 h-3.5" />
                      </button>
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
