"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import {
  deleteCategory, deleteFolder, deleteScheme, fetchCategories, fetchFolders, fetchSchemes, previewNumber, saveCategory, saveFolder, saveScheme,
  TYPE_LABELS, type ArchiveFolder, type Category, type LetterType, type NumberingScheme,
} from "@/lib/correspondence-api";
import { BTN_DANGER, BTN_PRIMARY, BTN_SOFT, ErrorBox, INPUT, LABEL, Section, Sheet, errText } from "./corr-ui";

const RESET_LABELS = { YEARLY: "هر سال شمسی", MONTHLY: "هر ماه شمسی", NEVER: "هرگز" } as const;

export function CorrSettingsView() {
  const [cats, setCats] = useState<Category[]>([]);
  const [schemes, setSchemes] = useState<NumberingScheme[]>([]);
  const [folders, setFolders] = useState<ArchiveFolder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [catEdit, setCatEdit] = useState<Partial<Category> | null>(null);
  const [schemeEdit, setSchemeEdit] = useState<Partial<NumberingScheme> | null>(null);
  const [folderEdit, setFolderEdit] = useState<Partial<ArchiveFolder> | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const [c, s, f] = await Promise.all([fetchCategories(), fetchSchemes(), fetchFolders()]);
      setCats(c);
      setSchemes(s);
      setFolders(f);
      for (const t of ["INCOMING", "OUTGOING", "INTERNAL"] as LetterType[]) {
        previewNumber(t).then((p) => setPreviews((x) => ({ ...x, [t]: p.next ?? "" }))).catch(() => {});
      }
    } catch (e) {
      setError(errText(e));
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const guard = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <div className="space-y-4">
      {error ? <ErrorBox>{error}</ErrorBox> : null}
      <Section title="سربرگ و قالب‌های متن">
        <div className="flex gap-2 flex-wrap">
          <Link href="/correspondence/settings/letterheads" className={BTN_SOFT}>سربرگ‌ها (طراحی جای شماره، تاریخ، متن، امضا…)</Link>
          <Link href="/correspondence/settings/templates" className={BTN_SOFT}>قالب‌های متن نامه</Link>
        </div>
      </Section>

      <Section title="شماره‌گذاری" right={<button className={BTN_PRIMARY} onClick={() => setSchemeEdit({ type: "OUTGOING", pattern: "صادره/{YYYY}/{SEQ:5}", resetPolicy: "YEARLY", startAt: 1, isActive: true })}>+ طرح جدید</button>}>
        <p className="text-[12px] text-muted mb-3 leading-6">توکن‌ها: {"{YYYY}"} سال شمسی، {"{YY}"} دو رقم سال، {"{MM}"} ماه، {"{SEQ:n}"} شماره‌ی ترتیبی n رقمی، {"{TYPE}"} نوع (و/ص/د)، {"{CAT}"} کد دسته. شماره فقط هنگام امضا (صادره/داخلی) یا ثبت (وارده) داده می‌شود و هرگز دوباره استفاده نمی‌شود؛ نامه‌ی باطل‌شده شماره‌اش را می‌سوزاند. تغییر الگو فقط روی نامه‌های بعدی اثر دارد.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
          {(["INCOMING", "OUTGOING", "INTERNAL"] as LetterType[]).map((t) => (
            <div key={t} className="rounded-xl bg-primary-soft/50 px-3 py-2 text-[12.5px]">شماره‌ی بعدی {TYPE_LABELS[t]}: <bdi dir="ltr" className="font-bold">{previews[t] ?? "…"}</bdi></div>
          ))}
        </div>
        <Card className="divide-y divide-border">
          {schemes.map((s) => (
            <div key={s.id} className="p-3 flex flex-wrap items-center gap-2 text-[12.5px]">
              <span className="font-bold">{s.name}</span>
              <span className="text-muted">{TYPE_LABELS[s.type]}</span>
              <bdi dir="ltr" className="font-mono">{s.pattern}</bdi>
              <span className="text-muted">بازنشانی: {RESET_LABELS[s.resetPolicy]}</span>
              {s.isDefault ? <span className="text-primary font-bold">پیش‌فرض</span> : null}
              {!s.isActive ? <span className="text-danger">غیرفعال</span> : null}
              <span className="ms-auto flex gap-2">
                <button className={BTN_SOFT} onClick={() => setSchemeEdit(s)}>ویرایش</button>
                <button className={BTN_DANGER} onClick={() => window.confirm("حذف این طرح؟") && void guard(() => deleteScheme(s.id))}>حذف</button>
              </span>
            </div>
          ))}
          {schemes.length === 0 ? <div className="p-4 text-[12.5px] text-muted">طرحی تعریف نشده؛ هنگام اولین شماره، طرح پیش‌فرض خودکار ساخته می‌شود.</div> : null}
        </Card>
      </Section>

      <Section title="دسته‌بندی نامه‌ها" right={<button className={BTN_PRIMARY} onClick={() => setCatEdit({ isActive: true, sortOrder: 0 })}>+ دسته‌ی جدید</button>}>
        <Card className="divide-y divide-border">
          {cats.filter((c) => !c.parentId).concat(cats.filter((c) => c.parentId)).map((c) => (
            <div key={c.id} className="p-3 flex flex-wrap items-center gap-2 text-[12.5px]">
              <span className="font-bold">{c.parentId ? "— " : ""}{c.name}</span>
              <bdi dir="ltr" className="text-muted">{c.code}</bdi>
              {c.parentId ? <span className="text-muted">زیرمجموعه‌ی {cats.find((p) => p.id === c.parentId)?.name}</span> : null}
              {!c.isActive ? <span className="text-danger">غیرفعال</span> : null}
              <span className="ms-auto flex gap-2">
                <button className={BTN_SOFT} onClick={() => setCatEdit(c)}>ویرایش</button>
                <button className={BTN_DANGER} onClick={() => window.confirm("حذف این دسته؟") && void guard(() => deleteCategory(c.id))}>حذف</button>
              </span>
            </div>
          ))}
          {cats.length === 0 ? <div className="p-4 text-[12.5px] text-muted">دسته‌ای تعریف نشده است.</div> : null}
        </Card>
      </Section>

      <Section title="پوشه‌های بایگانی و مهلت نگهداری" right={<button className={BTN_PRIMARY} onClick={() => setFolderEdit({})}>+ پوشه‌ی جدید</button>}>
        <Card className="divide-y divide-border">
          {folders.map((f) => (
            <div key={f.id} className="p-3 flex flex-wrap items-center gap-2 text-[12.5px]">
              <span className="font-bold">{f.parentId ? "— " : ""}{f.name}</span>
              <span className="text-muted">{f.retentionDays ? `نگهداری ${f.retentionDays} روز` : "بدون مهلت"}</span>
              <span className="ms-auto flex gap-2">
                <button className={BTN_SOFT} onClick={() => setFolderEdit(f)}>ویرایش</button>
                <button className={BTN_DANGER} onClick={() => window.confirm("حذف پوشه؟") && void guard(() => deleteFolder(f.id))}>حذف</button>
              </span>
            </div>
          ))}
          {folders.length === 0 ? <div className="p-4 text-[12.5px] text-muted">پوشه‌ای تعریف نشده است.</div> : null}
        </Card>
      </Section>

      {catEdit ? (
        <Sheet title={catEdit.id ? "ویرایش دسته" : "دسته‌ی جدید"} onClose={() => setCatEdit(null)}>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void guard(async () => { await saveCategory(catEdit.id ?? null, { code: catEdit.code, name: catEdit.name, parentId: catEdit.parentId ?? null, isActive: catEdit.isActive, sortOrder: catEdit.sortOrder }); setCatEdit(null); }); }}>
            <div><label className={LABEL}>نام</label><input className={INPUT} required value={catEdit.name ?? ""} onChange={(e) => setCatEdit({ ...catEdit, name: e.target.value })} /></div>
            <div><label className={LABEL}>کد (برای توکن {"{CAT}"})</label><input className={INPUT} required dir="ltr" value={catEdit.code ?? ""} onChange={(e) => setCatEdit({ ...catEdit, code: e.target.value })} /></div>
            <div><label className={LABEL}>دسته‌ی والد</label><select className={INPUT} value={catEdit.parentId ?? ""} onChange={(e) => setCatEdit({ ...catEdit, parentId: e.target.value || null })}><option value="">— ریشه —</option>{cats.filter((c) => c.id !== catEdit.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <label className="flex items-center gap-2 text-[13px] min-h-[40px]"><input type="checkbox" className="w-5 h-5" checked={catEdit.isActive ?? true} onChange={(e) => setCatEdit({ ...catEdit, isActive: e.target.checked })} />فعال</label>
            <div className="flex justify-end gap-2"><button type="button" className={BTN_SOFT} onClick={() => setCatEdit(null)}>انصراف</button><button className={BTN_PRIMARY}>ذخیره</button></div>
          </form>
        </Sheet>
      ) : null}

      {schemeEdit ? (
        <Sheet title={schemeEdit.id ? "ویرایش طرح شماره‌گذاری" : "طرح جدید"} onClose={() => setSchemeEdit(null)}>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void guard(async () => { await saveScheme(schemeEdit.id ?? null, schemeEdit.id ? { name: schemeEdit.name, pattern: schemeEdit.pattern, resetPolicy: schemeEdit.resetPolicy, startAt: schemeEdit.startAt, isDefault: schemeEdit.isDefault, isActive: schemeEdit.isActive } : schemeEdit); setSchemeEdit(null); }); }}>
            <div><label className={LABEL}>نام</label><input className={INPUT} required value={schemeEdit.name ?? ""} onChange={(e) => setSchemeEdit({ ...schemeEdit, name: e.target.value })} /></div>
            {!schemeEdit.id ? <div><label className={LABEL}>نوع نامه</label><select className={INPUT} value={schemeEdit.type} onChange={(e) => setSchemeEdit({ ...schemeEdit, type: e.target.value as LetterType })}>{Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div> : null}
            <div><label className={LABEL}>الگو</label><input className={INPUT} required dir="ltr" value={schemeEdit.pattern ?? ""} onChange={(e) => setSchemeEdit({ ...schemeEdit, pattern: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className={LABEL}>بازنشانی شمارنده</label><select className={INPUT} value={schemeEdit.resetPolicy} onChange={(e) => setSchemeEdit({ ...schemeEdit, resetPolicy: e.target.value as NumberingScheme["resetPolicy"] })}>{Object.entries(RESET_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
              <div><label className={LABEL}>شروع از</label><input type="number" min={0} className={INPUT} value={schemeEdit.startAt ?? 1} onChange={(e) => setSchemeEdit({ ...schemeEdit, startAt: Number(e.target.value) })} /></div>
            </div>
            <label className="flex items-center gap-2 text-[13px] min-h-[40px]"><input type="checkbox" className="w-5 h-5" checked={!!schemeEdit.isDefault} onChange={(e) => setSchemeEdit({ ...schemeEdit, isDefault: e.target.checked })} />طرح پیش‌فرض این نوع</label>
            <label className="flex items-center gap-2 text-[13px] min-h-[40px]"><input type="checkbox" className="w-5 h-5" checked={schemeEdit.isActive ?? true} onChange={(e) => setSchemeEdit({ ...schemeEdit, isActive: e.target.checked })} />فعال</label>
            <div className="flex justify-end gap-2"><button type="button" className={BTN_SOFT} onClick={() => setSchemeEdit(null)}>انصراف</button><button className={BTN_PRIMARY}>ذخیره</button></div>
          </form>
        </Sheet>
      ) : null}

      {folderEdit ? (
        <Sheet title={folderEdit.id ? "ویرایش پوشه" : "پوشه‌ی جدید"} onClose={() => setFolderEdit(null)}>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void guard(async () => { await saveFolder(folderEdit.id ?? null, { name: folderEdit.name, parentId: folderEdit.parentId ?? null, retentionDays: folderEdit.retentionDays || null }); setFolderEdit(null); }); }}>
            <div><label className={LABEL}>نام</label><input className={INPUT} required value={folderEdit.name ?? ""} onChange={(e) => setFolderEdit({ ...folderEdit, name: e.target.value })} /></div>
            <div><label className={LABEL}>پوشه‌ی والد</label><select className={INPUT} value={folderEdit.parentId ?? ""} onChange={(e) => setFolderEdit({ ...folderEdit, parentId: e.target.value || null })}><option value="">— ریشه —</option>{folders.filter((x) => x.id !== folderEdit.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
            <div><label className={LABEL}>مدت نگهداری (روز)</label><input type="number" min={1} className={INPUT} value={folderEdit.retentionDays ?? ""} onChange={(e) => setFolderEdit({ ...folderEdit, retentionDays: e.target.value ? Number(e.target.value) : null })} /></div>
            <div className="flex justify-end gap-2"><button type="button" className={BTN_SOFT} onClick={() => setFolderEdit(null)}>انصراف</button><button className={BTN_PRIMARY}>ذخیره</button></div>
          </form>
        </Sheet>
      ) : null}
    </div>
  );
}
