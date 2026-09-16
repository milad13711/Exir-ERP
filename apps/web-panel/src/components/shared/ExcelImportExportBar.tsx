import { useRef, useState } from "react";
import { downloadExcelFile, uploadExcelImport, ApiError, type ExcelImportSummary } from "@/lib/api";

/** Drop-in export/import toolbar for any module's list page — see products/contacts pages for usage. */
export function ExcelImportExportBar({
  exportPath,
  exportFilename,
  importPath,
  templatePath,
  templateFilename,
  onImported,
}: {
  exportPath: string;
  exportFilename: string;
  importPath: string;
  templatePath?: string;
  templateFilename?: string;
  onImported: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ExcelImportSummary | null>(null);

  async function handleExport() {
    setBusy(true);
    setError(null);
    try {
      await downloadExcelFile(exportPath, exportFilename);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  async function handleDownloadTemplate() {
    if (!templatePath) return;
    setBusy(true);
    setError(null);
    try {
      await downloadExcelFile(templatePath, templateFilename ?? "template.xlsx");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const result = await uploadExcelImport(importPath, file);
      setSummary(result);
      onImported();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {templatePath ? (
          <button
            disabled={busy}
            onClick={handleDownloadTemplate}
            className="text-[11.5px] font-bold text-ink-soft bg-slate-100 px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50"
          >
            دانلود نمونه
          </button>
        ) : null}
        <button
          disabled={busy}
          onClick={handleExport}
          className="text-[11.5px] font-bold text-ink-soft bg-slate-100 px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50"
        >
          خروجی اکسل
        </button>
        <button
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
          className="text-[11.5px] font-bold text-ink-soft bg-slate-100 px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50"
        >
          ورود از اکسل
        </button>
        <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={handleFileSelected} />
      </div>
      {error ? <div className="text-[11.5px] text-danger">{error}</div> : null}
      {summary ? (
        <div className="text-[11.5px] bg-slate-50 border border-border rounded-lg px-3 py-2 text-ink-soft">
          {summary.created} مورد جدید، {summary.updated} به‌روزرسانی‌شده، {summary.skipped} ردشده
          {summary.details.some((d) => d.status === "SKIPPED") ? (
            <ul className="mt-1.5 flex flex-col gap-0.5 text-muted">
              {summary.details
                .filter((d) => d.status === "SKIPPED")
                .slice(0, 10)
                .map((d) => (
                  <li key={d.row}>
                    ردیف {d.row}: {d.reason}
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
