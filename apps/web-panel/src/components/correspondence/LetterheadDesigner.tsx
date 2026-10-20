"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  BOX_KEYS,
  BOX_LABELS,
  PAGE_MM,
  letterheadSamplePdfUrl,
  updateLetterhead,
  type Letterhead,
  type LetterheadLayout,
  type LetterheadMeta,
  type LetterBoxKey,
  type LetterBoxLayout,
} from "@/lib/correspondence-docs-api";
import { fileToDataUri, uploadErrorMessage } from "@/lib/upload";

const inputClass = "w-full text-[12.5px] outline-none bg-slate-50 border border-border rounded-lg px-2.5 py-2 focus:border-primary";
const labelClass = "text-[11.5px] font-semibold text-ink-soft mb-1 block";

const SAMPLE_TEXT: Record<LetterBoxKey, string> = {
  number: "شماره: ۱۴۰۵/۱۲۳۴",
  date: "تاریخ: ۱۴۰۵/۰۷/۲۹",
  attachments: "پیوست: ۲ برگ",
  subject: "موضوع: درخواست همکاری",
  recipient: "جناب آقای دکتر محمدی — مدیرعامل محترم",
  body: "با سلام و احترام؛ این متن نمونه برای نمایش جایگاه، فونت و ترازبندی متن نامه است. محتوای واقعی در همین ناحیه قرار می‌گیرد و در صورت طولانی‌شدن به صفحه‌ی بعد ادامه می‌یابد. ".repeat(4),
  signature: "امضا و مهر — علی رضایی، مدیر",
  paraphs: "پاراف — محمد کریمی (مدیر مالی): با نظر موافق",
  qr: "QR",
  confidentiality: "محرمانه · فوری",
};

type Dir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const HANDLES: Dir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const HANDLE_POS: Record<Dir, string> = {
  n: "top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize",
  s: "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-ns-resize",
  e: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
  w: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
  ne: "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
  nw: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
  se: "right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize",
  sw: "left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize",
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Drag = { key: LetterBoxKey; mode: "move" | Dir; sx: number; sy: number; orig: LetterBoxLayout };

export function LetterheadDesigner({
  letterhead,
  meta,
  onSaved,
  onBack,
}: {
  letterhead: Letterhead;
  meta: LetterheadMeta;
  onSaved: (l: Letterhead) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState(letterhead.name);
  const [pageSize, setPageSize] = useState(letterhead.pageSize);
  const [orientation, setOrientation] = useState(letterhead.orientation);
  const [layout, setLayout] = useState<LetterheadLayout>(letterhead.layout);
  const [image, setImage] = useState<string | null>(letterhead.backgroundImage ?? null);
  const [imageChanged, setImageChanged] = useState(false);
  const [departmentId, setDepartmentId] = useState(letterhead.departmentId ?? "");
  const [selected, setSelected] = useState<LetterBoxKey>("body");
  const [grid, setGrid] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "pdf" | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [wrapW, setWrapW] = useState(600);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  const dims = useMemo(() => {
    const p = PAGE_MM[pageSize];
    return orientation === "landscape" ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
  }, [pageSize, orientation]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWrapW(el.clientWidth));
    ro.observe(el);
    setWrapW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // px به‌ازای هر میلی‌متر
  const scale = Math.max(0.5, ((wrapW - 16) / dims.w) * zoom);

  const patchBox = useCallback((key: LetterBoxKey, patch: Partial<LetterBoxLayout>) => {
    setLayout((l) => ({ ...l, boxes: { ...l.boxes, [key]: { ...l.boxes[key], ...patch } } }));
    setDirty(true);
  }, []);

  function snap(v: number): number {
    return grid > 0 ? Math.round(v / grid) * grid : r2(v);
  }

  /** مختصات را در برگه نگه می‌دارد (حداقل عرض/ارتفاع هم رعایت می‌شود). */
  function fit(b: LetterBoxLayout): LetterBoxLayout {
    const w = clamp(b.wMm, 5, dims.w);
    const h = clamp(b.hMm, 3, dims.h);
    return { ...b, wMm: r2(w), hMm: r2(h), xMm: r2(clamp(b.xMm, 0, dims.w - w)), yMm: r2(clamp(b.yMm, 0, dims.h - h)) };
  }

  function onPointerDown(e: React.PointerEvent, key: LetterBoxKey, mode: "move" | Dir) {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setSelected(key);
    setSheetOpen(true);
    drag.current = { key, mode, sx: e.clientX, sy: e.clientY, orig: layout.boxes[key] };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / scale;
    const dy = (e.clientY - d.sy) / scale;
    const o = d.orig;
    let { xMm: x, yMm: y, wMm: w, hMm: h } = o;
    if (d.mode === "move") {
      x = snap(o.xMm + dx);
      y = snap(o.yMm + dy);
    } else {
      if (d.mode.includes("e")) w = snap(o.xMm + o.wMm + dx) - o.xMm;
      if (d.mode.includes("s")) h = snap(o.yMm + o.hMm + dy) - o.yMm;
      if (d.mode.includes("w")) {
        const nx = snap(o.xMm + dx);
        w = o.xMm + o.wMm - nx;
        x = nx;
      }
      if (d.mode.includes("n")) {
        const ny = snap(o.yMm + dy);
        h = o.yMm + o.hMm - ny;
        y = ny;
      }
      if (w < 5) {
        if (d.mode.includes("w")) x = o.xMm + o.wMm - 5;
        w = 5;
      }
      if (h < 3) {
        if (d.mode.includes("n")) y = o.yMm + o.hMm - 3;
        h = 3;
      }
    }
    patchBox(d.key, fit({ ...o, xMm: x, yMm: y, wMm: w, hMm: h }));
  }

  function onPointerUp() {
    drag.current = null;
  }

  /** جابه‌جایی با کلیدهای جهتی؛ Shift = ۵ برابر؛ Ctrl/⌘ = تغییر اندازه. */
  function onKeyDown(e: React.KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA") return;
    const step = (grid > 0 ? grid : 0.5) * (e.shiftKey ? 5 : 1);
    const b = layout.boxes[selected];
    let dx = 0;
    let dy = 0;
    if (e.key === "ArrowLeft") dx = -step;
    else if (e.key === "ArrowRight") dx = step;
    else if (e.key === "ArrowUp") dy = -step;
    else if (e.key === "ArrowDown") dy = step;
    else return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) patchBox(selected, fit({ ...b, wMm: b.wMm + dx, hMm: b.hMm + dy }));
    else patchBox(selected, fit({ ...b, xMm: b.xMm + dx, yMm: b.yMm + dy }));
  }

  async function onPickImage(file: File | undefined) {
    if (!file) return;
    setMsg(null);
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
      setMsg({ kind: "err", text: "فایل PDF پذیرفته نمی‌شود؛ صفحه‌ی سربرگ را به‌صورت تصویر (PNG یا JPEG) ذخیره و بارگذاری کنید." });
      return;
    }
    try {
      const uri = await fileToDataUri(file, "image", { maxDimension: 2480, quality: 0.9, targetBytes: 2.6 * 1024 * 1024 });
      setImage(uri);
      setImageChanged(true);
      setDirty(true);
    } catch (e) {
      setMsg({ kind: "err", text: uploadErrorMessage(e) });
    }
  }

  function changePage(size: "A4" | "A5", o: "portrait" | "landscape") {
    if (size === pageSize && o === orientation) return;
    if (!window.confirm("با تغییر اندازه یا جهت صفحه، چیدمان جعبه‌ها به حالت پیش‌فرض آن اندازه برمی‌گردد. ادامه می‌دهید؟")) return;
    setPageSize(size);
    setOrientation(o);
    setLayout({ ...meta.defaults[size][o], letterheadOnAllPages: layout.letterheadOnAllPages });
    setDirty(true);
  }

  async function save() {
    setBusy("save");
    setMsg(null);
    try {
      const saved = await updateLetterhead(letterhead.id, {
        name,
        pageSize,
        orientation,
        layout: { ...layout, pageSize, orientation },
        departmentId: departmentId.trim() || null,
        ...(imageChanged ? { backgroundImage: image } : {}),
      });
      setDirty(false);
      setImageChanged(false);
      setMsg({ kind: "ok", text: "ذخیره شد" });
      onSaved({ ...saved, backgroundImage: image });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "ذخیره ناموفق بود" });
    } finally {
      setBusy(null);
    }
  }

  async function previewPdf(long: boolean) {
    setBusy("pdf");
    setMsg(null);
    try {
      // پیش‌نمایش از «پیش‌نویس جاری» طراح (ذخیره‌نشده هم) ساخته می‌شود
      const url = await letterheadSamplePdfUrl(letterhead.id, {
        long,
        persianDigits: true,
        layout: { ...layout, pageSize, orientation },
        pageSize,
        orientation,
        backgroundImage: image,
      });
      window.open(url, "_blank", "noopener");
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "ساخت PDF ناموفق بود" });
    } finally {
      setBusy(null);
    }
  }

  const sel = layout.boxes[selected];
  const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v.trim() !== "" ? Number(v) : fallback);

  const panel = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between lg:hidden">
        <b className="text-[13px]">{BOX_LABELS[selected]}</b>
        <button type="button" onClick={() => setSheetOpen(false)} className="text-[12px] text-muted cursor-pointer">
          بستن
        </button>
      </div>
      <div className="hidden lg:block text-[13px] font-extrabold">{BOX_LABELS[selected]}</div>
      <label className="flex items-center gap-2 text-[12.5px]">
        <input type="checkbox" checked={sel.visible} onChange={(e) => patchBox(selected, { visible: e.target.checked })} />
        نمایش در نامه
      </label>
      <div className="grid grid-cols-4 gap-2">
        {(
          [
            ["xMm", "x"],
            ["yMm", "y"],
            ["wMm", "عرض"],
            ["hMm", "ارتفاع"],
          ] as const
        ).map(([k, l]) => (
          <div key={k}>
            <label className={labelClass}>{l} (mm)</label>
            <input
              type="number"
              step={0.5}
              value={sel[k]}
              onChange={(e) => patchBox(selected, fit({ ...sel, [k]: num(e.target.value, sel[k]) }))}
              className={inputClass}
            />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>فونت</label>
          <select value={sel.fontFamily} onChange={(e) => patchBox(selected, { fontFamily: e.target.value })} className={inputClass}>
            {meta.fonts.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>اندازه (pt)</label>
          <input type="number" min={6} max={72} step={0.5} value={sel.fontSizePt} onChange={(e) => patchBox(selected, { fontSizePt: clamp(num(e.target.value, sel.fontSizePt), 6, 72) })} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>فاصله‌ی خطوط</label>
          <input type="number" min={0.8} max={3} step={0.1} value={sel.lineHeight} onChange={(e) => patchBox(selected, { lineHeight: clamp(num(e.target.value, sel.lineHeight), 0.8, 3) })} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>رنگ</label>
          <input type="color" value={sel.color} onChange={(e) => patchBox(selected, { color: e.target.value })} className="w-full h-[34px] rounded-lg border border-border bg-slate-50 cursor-pointer" />
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <label className="flex items-center gap-1.5 text-[12.5px] ml-2">
          <input type="checkbox" checked={sel.bold} onChange={(e) => patchBox(selected, { bold: e.target.checked })} />
          ضخیم
        </label>
        {(
          [
            ["right", "راست"],
            ["center", "وسط"],
            ["left", "چپ"],
            ["justify", "دوطرفه"],
          ] as const
        ).map(([a, l]) => (
          <button
            key={a}
            type="button"
            onClick={() => patchBox(selected, { align: a })}
            className={clsx("text-[11.5px] font-bold px-2.5 py-1.5 rounded-lg border cursor-pointer", sel.align === a ? "bg-primary text-white border-primary" : "border-border text-ink-soft")}
          >
            {l}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted leading-5">کلیدهای جهتی: جابه‌جایی؛ Shift: پرش بزرگ؛ Ctrl/⌘ + جهتی: تغییر اندازه. مبدأ مختصات گوشه‌ی بالا-چپ برگه است.</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-4" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={onBack} className="text-[12.5px] font-bold border border-border rounded-xl px-3 py-2 cursor-pointer">
          بازگشت
        </button>
        <input value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} className={clsx(inputClass, "max-w-[260px]")} aria-label="نام سربرگ" />
        <div className="flex-1" />
        <button type="button" disabled={busy !== null} onClick={() => previewPdf(false)} className="text-[12.5px] font-bold border border-border rounded-xl px-3 py-2 cursor-pointer disabled:opacity-50">
          {busy === "pdf" ? "در حال ساخت…" : "پیش‌نمایش PDF"}
        </button>
        <button type="button" disabled={busy !== null} onClick={() => previewPdf(true)} className="text-[12.5px] font-bold border border-border rounded-xl px-3 py-2 cursor-pointer disabled:opacity-50">
          PDF چندصفحه‌ای
        </button>
        <button type="button" disabled={busy !== null || !dirty} onClick={save} className="text-[12.5px] font-bold bg-primary text-white rounded-xl px-4 py-2 cursor-pointer disabled:opacity-50">
          {busy === "save" ? "…" : dirty ? "ذخیره" : "ذخیره‌شده"}
        </button>
      </div>
      {msg && <div className={clsx("text-[12.5px] rounded-lg px-3 py-2", msg.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>{msg.text}</div>}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="order-2 lg:order-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap text-[12px]">
            <span className="text-muted">بزرگ‌نمایی</span>
            <button type="button" onClick={() => setZoom((z) => clamp(r2(z - 0.25), 0.5, 3))} className="w-8 h-8 border border-border rounded-lg cursor-pointer">−</button>
            <span className="w-10 text-center">{Math.round(zoom * 100)}٪</span>
            <button type="button" onClick={() => setZoom((z) => clamp(r2(z + 0.25), 0.5, 3))} className="w-8 h-8 border border-border rounded-lg cursor-pointer">+</button>
            <label className="flex items-center gap-1.5 mr-3">
              شبکه
              <select value={grid} onChange={(e) => setGrid(Number(e.target.value))} className="border border-border rounded-lg px-1.5 py-1 bg-surface">
                <option value={0}>آزاد</option>
                <option value={0.5}>۰٫۵ mm</option>
                <option value={1}>۱ mm</option>
                <option value={2.5}>۲٫۵ mm</option>
                <option value={5}>۵ mm</option>
              </select>
            </label>
          </div>
          <div ref={wrapRef} className="overflow-auto rounded-xl border border-border bg-slate-100 p-2" style={{ maxHeight: "78vh" }}>
            <div
              dir="ltr"
              tabIndex={0}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerDown={() => setSheetOpen(false)}
              className="relative bg-white shadow-md outline-none mx-auto select-none"
              style={{
                width: dims.w * scale,
                height: dims.h * scale,
                backgroundImage: image ? `url(${image})` : undefined,
                backgroundSize: "100% 100%",
                backgroundRepeat: "no-repeat",
              }}
              aria-label="پیش‌نمایش صفحه"
            >
              {/* خطوط حاشیه‌ی صفحات بعدی */}
              <div
                className="absolute border border-dashed border-sky-400/60 pointer-events-none"
                style={{
                  left: layout.continuationMarginsMm.left * scale,
                  right: layout.continuationMarginsMm.right * scale,
                  top: layout.continuationMarginsMm.top * scale,
                  bottom: layout.continuationMarginsMm.bottom * scale,
                }}
              />
              {BOX_KEYS.map((key) => {
                const b = layout.boxes[key];
                const active = key === selected;
                return (
                  <div
                    key={key}
                    role="button"
                    aria-label={BOX_LABELS[key]}
                    onPointerDown={(e) => onPointerDown(e, key, "move")}
                    className={clsx(
                      "absolute overflow-hidden cursor-move border touch-none",
                      active ? "border-primary bg-primary/10 z-10" : "border-slate-400/70 bg-white/50",
                      !b.visible && "opacity-40 border-dashed",
                    )}
                    style={{
                      left: b.xMm * scale,
                      top: b.yMm * scale,
                      width: b.wMm * scale,
                      height: b.hMm * scale,
                      fontFamily: `${b.fontFamily}, Vazirmatn, Tahoma, sans-serif`,
                      fontSize: b.fontSizePt * 0.3528 * scale,
                      fontWeight: b.bold ? 700 : 400,
                      color: b.color,
                      textAlign: b.align,
                      lineHeight: b.lineHeight,
                    }}
                  >
                    <div dir="rtl" className="w-full h-full">
                      {key === "qr" ? (
                        <div className="w-full h-full bg-[repeating-conic-gradient(#222_0_25%,#fff_0_50%)] bg-[length:12px_12px] opacity-70" />
                      ) : (
                        SAMPLE_TEXT[key]
                      )}
                    </div>
                  </div>
                );
              })}
              {/* دستگیره‌ها خارج از جعبه (overflow-hidden) رندر می‌شوند */}
              {(() => {
                const b = layout.boxes[selected];
                return (
                  <div className="absolute z-20 pointer-events-none" style={{ left: b.xMm * scale, top: b.yMm * scale, width: b.wMm * scale, height: b.hMm * scale }}>
                    {HANDLES.map((h) => (
                      <div
                        key={h}
                        onPointerDown={(e) => onPointerDown(e, selected, h)}
                        className={clsx("absolute pointer-events-auto touch-none bg-primary border-2 border-white rounded-sm w-3.5 h-3.5 [@media(pointer:coarse)]:w-6 [@media(pointer:coarse)]:h-6", HANDLE_POS[h])}
                      />
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        <div className="order-1 lg:order-2 flex flex-col gap-4">
          <div className="border border-border rounded-xl p-3 flex flex-col gap-3 bg-surface">
            <div className="text-[13px] font-extrabold">تنظیمات سربرگ</div>
            <div>
              <label className={labelClass}>تصویر سربرگ (PNG / JPEG / WebP، حداکثر ۳ مگابایت)</label>
              <div className="flex items-center gap-2">
                <label className="text-[12px] font-bold border border-border rounded-lg px-3 py-2 cursor-pointer">
                  انتخاب تصویر
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { void onPickImage(e.target.files?.[0]); e.target.value = ""; }} />
                </label>
                {image && (
                  <button type="button" onClick={() => { setImage(null); setImageChanged(true); setDirty(true); }} className="text-[12px] text-red-600 cursor-pointer">
                    حذف تصویر
                  </button>
                )}
              </div>
              <p className="text-[11px] text-muted mt-1 leading-5">فایل PDF پذیرفته نمی‌شود: صفحه‌ی سربرگ را به‌صورت تصویر ذخیره کنید (برای کیفیت چاپ، حدود ۲۰۰ تا ۳۰۰ dpi).</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelClass}>اندازه‌ی کاغذ</label>
                <select value={pageSize} onChange={(e) => changePage(e.target.value as "A4" | "A5", orientation)} className={inputClass}>
                  <option value="A4">A4</option>
                  <option value="A5">A5</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>جهت</label>
                <select value={orientation} onChange={(e) => changePage(pageSize, e.target.value as "portrait" | "landscape")} className={inputClass}>
                  <option value="portrait">عمودی</option>
                  <option value="landscape">افقی</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-[12.5px]">
              <input type="checkbox" checked={layout.letterheadOnAllPages} onChange={(e) => { setLayout({ ...layout, letterheadOnAllPages: e.target.checked }); setDirty(true); }} />
              سربرگ روی همه‌ی صفحات (نه فقط صفحه‌ی اول)
            </label>
            <div>
              <label className={labelClass}>حاشیه‌ی صفحات بعدی (mm)</label>
              <div className="grid grid-cols-4 gap-2">
                {(
                  [
                    ["top", "بالا"],
                    ["bottom", "پایین"],
                    ["right", "راست"],
                    ["left", "چپ"],
                  ] as const
                ).map(([k, l]) => (
                  <div key={k}>
                    <span className="text-[10.5px] text-muted">{l}</span>
                    <input
                      type="number"
                      min={0}
                      max={120}
                      value={layout.continuationMarginsMm[k]}
                      onChange={(e) => { setLayout({ ...layout, continuationMarginsMm: { ...layout.continuationMarginsMm, [k]: clamp(num(e.target.value, 0), 0, 120) } }); setDirty(true); }}
                      className={inputClass}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <label className={labelClass}>واحد سازمانی (اختیاری — شناسه)</label>
              <input value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setDirty(true); }} className={inputClass} placeholder="خالی = سربرگ عمومی" />
            </div>
          </div>

          <div className="border border-border rounded-xl p-3 bg-surface">
            <div className="text-[13px] font-extrabold mb-2">جعبه‌ها</div>
            <div className="flex flex-wrap gap-1.5">
              {BOX_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => { setSelected(k); setSheetOpen(true); }}
                  className={clsx("text-[11.5px] font-bold px-2.5 py-1.5 rounded-lg border cursor-pointer", selected === k ? "bg-primary text-white border-primary" : "border-border text-ink-soft", !layout.boxes[k].visible && "opacity-50")}
                >
                  {BOX_LABELS[k]}
                </button>
              ))}
            </div>
          </div>

          {/* ویژگی‌های جعبه: ستون کناری در دسکتاپ، برگه‌ی پایین در موبایل */}
          <div
            className={clsx(
              "bg-surface border border-border rounded-xl p-3",
              "max-lg:fixed max-lg:bottom-0 max-lg:inset-x-0 max-lg:z-40 max-lg:rounded-b-none max-lg:max-h-[55vh] max-lg:overflow-y-auto max-lg:shadow-2xl",
              !sheetOpen && "max-lg:hidden",
            )}
          >
            {panel}
          </div>
        </div>
      </div>
    </div>
  );
}
