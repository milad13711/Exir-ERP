"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { ReasonDialog } from "@/components/ui/ReasonDialog";
import { useModuleCan } from "@/hooks/useModuleCan";
import { formatJalaliDateTime, formatNumber, formatToman } from "@/lib/persian";
import {
  ApiError,
  commitStockImport,
  downloadExcelFile,
  fetchStockImportBatches,
  previewStockImport,
  voidStockImportBatch,
  type StockImportBatch,
  type StockImportPreview,
} from "@/lib/api";

const SHOW_LIMIT = 300;

/**
 * ورود «موجودی اولیه» از اکسل (مهاجرت از نرم‌افزار قبلی): قالب → آپلود → پیش‌نمایش با خطاهای فارسی → تأیید و ثبت یک‌جا.
 * ثبت جزئی وجود ندارد؛ هر خطا باید در فایل اصلاح شود. فایل یکسان دوباره وارد نمی‌شود.
 */
export function StockImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [createMissing, setCreateMissing] = useState(false);
  const [preview, setPreview] = useState<StockImportPreview | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [batches, setBatches] = useState<StockImportBatch[]>([]);
  const [voidFor, setVoidFor] = useState<StockImportBatch | null>(null);
  const can = useModuleCan("warehouse");
  const allowed = can.canCreate && can.canEdit;

  function loadBatches() {
    fetchStockImportBatches().then(setBatches).catch(() => setBatches([]));
  }
  useEffect(loadBatches, []);

  async function runPreview(f: File, missing: boolean) {
    setBusy(true);
    setError(null);
    setDone(null);
    setConfirm(false);
    try {
      setPreview(await previewStockImport(f, missing));
    } catch (err) {
      setPreview(null);
      setError(err instanceof ApiError ? err.message : "خواندن فایل ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setFile(f);
    await runPreview(f, createMissing);
  }

  async function onToggleMissing(v: boolean) {
    setCreateMissing(v);
    if (file) await runPreview(file, v);
  }

  async function commit() {
    if (!file || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const r = await commitStockImport(file, createMissing, preview.fileHash);
      setDone(
        `${formatNumber(r.rows)} ردیف ثبت شد${r.createdProducts ? ` · ${formatNumber(r.createdProducts)} کالای جدید ساخته شد` : ""} · ارزش ${formatToman(r.totalValue)}${r.journalPosted ? " · سند افتتاحیه ثبت شد" : ""}`,
      );
      setPreview(null);
      setFile(null);
      loadBatches();
      onImported();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  const rows = preview ? (onlyErrors ? preview.rows.filter((r) => r.status === "ERROR") : preview.rows) : [];

  return (
    <Modal title="ورود موجودی اولیه از اکسل" onClose={onClose} width="max-w-[860px]">
      <div className="flex flex-col gap-4">
        <div className="text-[12.5px] leading-7 text-ink-soft">
          برای مهاجرت از نرم‌افزار قبلی: فایل نمونه را بگیرید، موجودی هر کالا را به تفکیک انبار پر کنید و بارگذاری کنید. ابتدا فقط «پیش‌نمایش» می‌بینید و چیزی ثبت نمی‌شود؛ پس از تأیید، همه‌ی ردیف‌ها
          یک‌جا به‌صورت «رسید موجودی اولیه» ثبت می‌شوند (و اگر ماژول حسابداری نصب باشد، سند افتتاحیه هم زده می‌شود). لات/بچ و محل قفسه در توضیح رسید ذخیره می‌شود.
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => downloadExcelFile("/warehouse/stock-import/template", "opening-stock-template.xlsx").catch((e) => setError(e instanceof Error ? e.message : "دانلود ناموفق بود"))}
            className="text-[12px] font-bold text-ink-soft bg-slate-100 px-3.5 py-2.5 rounded-xl cursor-pointer"
          >
            دانلود فایل نمونه
          </button>
          <button
            disabled={busy || !allowed}
            onClick={() => fileRef.current?.click()}
            className="text-[12px] font-bold text-white bg-primary px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
          >
            {file ? "انتخاب فایل دیگر" : "انتخاب فایل اکسل (xlsx)"}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={onFile} />
          <label className="flex items-center gap-2 text-[12px] font-semibold cursor-pointer">
            <input type="checkbox" checked={createMissing} onChange={(e) => onToggleMissing(e.target.checked)} className="w-4 h-4" />
            ساخت خودکار کالاهای ناموجود
          </label>
          {file ? <span className="text-[11.5px] text-muted" dir="ltr">{file.name}</span> : null}
        </div>
        {!allowed ? <div className="text-[12px] text-danger">برای ورود موجودی اولیه به دسترسی «ایجاد» و «ویرایش» انبار نیاز دارید.</div> : null}

        {busy ? <div className="text-[12px] text-muted">در حال پردازش...</div> : null}
        {error ? <div className="text-[12.5px] text-danger bg-danger-soft rounded-xl px-3.5 py-2.5">{error}</div> : null}
        {done ? <div className="text-[12.5px] text-success font-semibold bg-slate-50 border border-border rounded-xl px-3.5 py-2.5">{done}</div> : null}

        {preview ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 flex-wrap text-[12px]">
              <Badge tone="success">{formatNumber(preview.okCount)} ردیف سالم</Badge>
              <Badge tone={preview.errorCount ? "danger" : "neutral"}>{formatNumber(preview.errorCount)} ردیف خطا</Badge>
              {preview.newProducts ? <Badge tone="primary">{formatNumber(preview.newProducts)} کالای جدید</Badge> : null}
              <span className="text-muted">جمع تعداد: {formatNumber(preview.totalQuantity)} · ارزش: {formatToman(preview.totalValue)}</span>
              {preview.errorCount ? (
                <label className="flex items-center gap-1.5 mr-auto cursor-pointer font-semibold">
                  <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} className="w-4 h-4" />
                  فقط خطاها
                </label>
              ) : null}
            </div>

            {preview.duplicateOf ? (
              <div className="text-[12.5px] text-danger bg-danger-soft rounded-xl px-3.5 py-2.5">
                این فایل قبلاً در {formatJalaliDateTime(preview.duplicateOf.createdAt)} وارد شده است ({formatNumber(preview.duplicateOf.rowCount)} ردیف). برای ورود دوباره ابتدا آن دسته را باطل کنید.
              </div>
            ) : null}
            {preview.tooManyRows ? (
              <div className="text-[12.5px] text-danger bg-danger-soft rounded-xl px-3.5 py-2.5">حداکثر {formatNumber(preview.maxRows)} ردیف در هر ورود مجاز است؛ فایل را تقسیم کنید.</div>
            ) : null}

            <div className="border border-border rounded-xl overflow-auto max-h-[44vh]">
              <table className="w-full text-[12px] min-w-[640px]">
                <thead className="bg-slate-50 sticky top-0">
                  <tr className="text-right text-muted">
                    <th className="px-3 py-2 font-semibold">ردیف</th>
                    <th className="px-3 py-2 font-semibold">کالا</th>
                    <th className="px-3 py-2 font-semibold">انبار</th>
                    <th className="px-3 py-2 font-semibold">تعداد</th>
                    <th className="px-3 py-2 font-semibold">بهای واحد</th>
                    <th className="px-3 py-2 font-semibold">وضعیت</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, SHOW_LIMIT).map((r) => (
                    <tr key={r.row} className="border-t border-border align-top">
                      <td className="px-3 py-2" dir="ltr">{r.row}</td>
                      <td className="px-3 py-2">
                        <div className="font-semibold">{r.name || r.sku}</div>
                        <div className="text-[11px] text-muted" dir="ltr">{r.sku}{r.createsProduct ? " · جدید" : ""}</div>
                      </td>
                      <td className="px-3 py-2">{r.warehouseName}</td>
                      <td className="px-3 py-2" dir="ltr">{formatNumber(r.quantity)}</td>
                      <td className="px-3 py-2" dir="ltr">{r.unitCost != null ? formatNumber(r.unitCost) : "—"}</td>
                      <td className="px-3 py-2">
                        {r.status === "OK" ? <span className="text-success font-semibold">سالم</span> : <span className="text-danger font-semibold">خطا</span>}
                        {r.messages.map((m, i) => (
                          <div key={i} className="text-danger text-[11px] leading-5">{m}</div>
                        ))}
                        {r.warnings.map((m, i) => (
                          <div key={i} className="text-muted text-[11px] leading-5">{m}</div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > SHOW_LIMIT ? <div className="text-center text-[11.5px] text-muted py-2">فقط {SHOW_LIMIT} ردیف اول نمایش داده شد ({formatNumber(rows.length)} ردیف)</div> : null}
            </div>

            <label className="flex items-start gap-2 text-[12.5px] cursor-pointer">
              <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} disabled={!preview.canCommit} className="w-4 h-4 mt-1" />
              <span>
                تأیید می‌کنم که {formatNumber(preview.okCount)} ردیف (ارزش {formatToman(preview.totalValue)}) به‌عنوان موجودی اولیه ثبت شود. بعداً فقط از همین بخش (ابطال کل دسته) قابل بازگشت است.
              </span>
            </label>
            <button
              onClick={commit}
              disabled={busy || !preview.canCommit || !confirm}
              className="w-full py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer disabled:opacity-50"
            >
              {busy ? "در حال ثبت..." : "ثبت نهایی موجودی اولیه"}
            </button>
            {!preview.canCommit && preview.errorCount > 0 ? <div className="text-[11.5px] text-muted">ثبت جزئی انجام نمی‌شود؛ خطاها را در فایل اصلاح و دوباره بارگذاری کنید.</div> : null}
          </div>
        ) : null}

        {batches.length > 0 ? (
          <div className="border-t border-border pt-3">
            <div className="text-[12.5px] font-bold mb-2">ورودهای قبلی</div>
            <div className="flex flex-col gap-1.5">
              {batches.map((b) => (
                <div key={b.id} className="flex items-center gap-2 flex-wrap text-[12px] bg-slate-50 border border-border rounded-xl px-3 py-2">
                  <span className="font-semibold" dir="ltr">{b.fileName ?? "—"}</span>
                  <span className="text-muted">{formatJalaliDateTime(b.createdAt)}</span>
                  <span className="text-muted">{formatNumber(b.rowCount)} ردیف · {formatToman(b.totalValue)}</span>
                  {b.voidedAt ? (
                    <Badge tone="danger">باطل‌شده</Badge>
                  ) : can.canDelete ? (
                    <button onClick={() => setVoidFor(b)} className="mr-auto text-[11.5px] font-bold text-danger bg-danger-soft px-2.5 py-1.5 rounded-lg cursor-pointer">
                      ابطال کل دسته
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {voidFor ? (
        <ReasonDialog
          title="ابطال دسته‌ی موجودی اولیه"
          description="همه‌ی رسیدهای این دسته با ردیف معکوس خنثی می‌شوند و سند افتتاحیه (در صورت وجود) با سند معکوس ابطال می‌شود. اگر پس از ورود، از این موجودی حواله یا فاکتوری خارج شده باشد، ابطال رد می‌شود."
          confirmLabel="ابطال کل دسته"
          onConfirm={async (reason) => {
            await voidStockImportBatch(voidFor.id, reason);
            loadBatches();
            onImported();
          }}
          onClose={() => setVoidFor(null)}
        />
      ) : null}
    </Modal>
  );
}
