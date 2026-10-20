"use client";

import { useRef, useState } from "react";
import clsx from "clsx";
import { fileToDataUri, uploadErrorMessage } from "@/lib/upload";
import { toPersianDigits } from "@/lib/persian";
import { BTN_DANGER, BTN_SOFT, ErrorBox } from "./corr-ui";

export type ScanPage = { id: string; name: string; dataUri: string; isPdf: boolean };

/**
 * اسکن چندصفحه‌ای نامه‌ی اصلی: تصویر یا PDF، دوربین موبایل، فشرده‌سازی خودکار (prepareUpload)، ترتیب‌دهی/حذف و پیش‌نمایش.
 * فایل‌ها تا لحظه‌ی ثبت فقط در حافظه‌ی مرورگر می‌مانند.
 */
export function ScanManager({ pages, onChange }: { pages: ScanPage[]; onChange: (p: ScanPage[]) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    setError(null);
    const added: ScanPage[] = [];
    for (const file of Array.from(list)) {
      try {
        const dataUri = await fileToDataUri(file, file.type.startsWith("image/") ? "image" : "file");
        added.push({ id: crypto.randomUUID(), name: file.name || `صفحه ${pages.length + added.length + 1}`, dataUri, isPdf: file.type === "application/pdf" });
      } catch (e) {
        setError(`${file.name}: ${uploadErrorMessage(e)}`);
      }
    }
    if (added.length) {
      const next = [...pages, ...added];
      onChange(next);
      setActive(added[0].id);
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (camRef.current) camRef.current.value = "";
  }

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= pages.length) return;
    const n = [...pages];
    [n[i], n[j]] = [n[j], n[i]];
    onChange(n);
  };
  const current = pages.find((p) => p.id === active) ?? pages[0];

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        <button type="button" className={BTN_SOFT} disabled={busy} onClick={() => camRef.current?.click()}>عکس / اسکن با دوربین</button>
        <button type="button" className={BTN_SOFT} disabled={busy} onClick={() => fileRef.current?.click()}>انتخاب فایل (تصویر یا PDF)</button>
        {busy ? <span className="text-[12px] text-muted self-center">در حال آماده‌سازی…</span> : null}
        <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void addFiles(e.target.files)} />
        <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => void addFiles(e.target.files)} />
      </div>
      {error ? <ErrorBox>{error}</ErrorBox> : null}
      {pages.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border text-center text-[12.5px] text-muted py-8 px-3">هنوز صفحه‌ای اضافه نشده است. می‌توانید چند صفحه را پشت‌سرهم عکس بگیرید یا فایل انتخاب کنید.</div>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {pages.map((p, i) => (
              <div key={p.id} className={clsx("shrink-0 w-[92px] border rounded-xl p-1.5 bg-white", current?.id === p.id ? "border-primary" : "border-border")}>
                <button type="button" className="block w-full h-[80px] bg-slate-50 rounded-lg overflow-hidden cursor-pointer" onClick={() => setActive(p.id)} aria-label={`نمایش صفحه ${i + 1}`}>
                  {p.isPdf ? (
                    <span className="text-[12px] font-bold text-ink-soft">PDF</span>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.dataUri} alt="" className="w-full h-full object-cover" />
                  )}
                </button>
                <div className="text-[11px] text-center mt-1">صفحه {toPersianDigits(i + 1)}</div>
                <div className="flex justify-between mt-1">
                  <button type="button" className="w-7 h-7 text-[14px] cursor-pointer disabled:opacity-30" disabled={i === pages.length - 1} onClick={() => move(i, 1)} aria-label="انتقال به بعد">◂</button>
                  <button type="button" className="w-7 h-7 text-[14px] cursor-pointer disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="انتقال به قبل">▸</button>
                </div>
              </div>
            ))}
          </div>
          {current ? (
            <div className="border border-border rounded-xl overflow-hidden bg-slate-50">
              {current.isPdf ? (
                <iframe title="پیش‌نمایش اسکن" src={current.dataUri} className="w-full h-[420px]" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={current.dataUri} alt="پیش‌نمایش اسکن" className="w-full max-h-[520px] object-contain" />
              )}
              <div className="p-2 flex justify-end">
                <button type="button" className={BTN_DANGER} onClick={() => { onChange(pages.filter((p) => p.id !== current.id)); setActive(null); }}>حذف این صفحه</button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
