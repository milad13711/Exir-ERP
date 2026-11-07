"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { useWorkspace } from "@/lib/workspace-context";
import { setMoneyUnit, toPersianDigits, formatJalaliDateTime } from "@/lib/persian";
import {
  ApiError,
  executeBaseCurrency,
  fetchBaseCurrencyConversion,
  fetchBaseCurrencyHistory,
  fetchBaseCurrencyState,
  previewBaseCurrency,
  requestBaseCurrencyConfirmation,
  requestBaseCurrencyReverseConfirmation,
  reverseBaseCurrency,
  type BaseCurrencyConversionSummary,
  type BaseCurrencyDetail,
  type BaseCurrencyPreview,
  type BaseCurrencyState,
} from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";
const btnPrimary = "px-4 py-2.5 rounded-xl bg-primary text-white text-[12.5px] font-bold cursor-pointer disabled:opacity-50";
const btnGhost = "px-4 py-2.5 rounded-xl bg-surface border border-border text-[12.5px] font-bold text-ink-soft cursor-pointer disabled:opacity-50";

function fmt(v: string): string {
  try {
    return toPersianDigits(BigInt(v).toLocaleString("en-US").replace(/,/g, "٬"));
  } catch {
    return v;
  }
}

type Target = { toCode: string; toLabel: string; rate: string; custom: boolean };
type Step = "target" | "preview" | "confirm" | "progress" | "result";

const STATUS_FA: Record<string, string> = { PENDING: "در صف", RUNNING: "در حال اجرا", DONE: "انجام شد", FAILED: "ناموفق (بدون تغییر)" };

export function BaseCurrencyCard() {
  const { me } = useWorkspace();
  const isOwner = me?.user.membershipRole === "OWNER";
  const [state, setState] = useState<BaseCurrencyState | null>(null);
  const [history, setHistory] = useState<BaseCurrencyConversionSummary[]>([]);
  const [wizard, setWizard] = useState<null | { mode: "convert" } | { mode: "reverse"; conv: BaseCurrencyConversionSummary }>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetchBaseCurrencyState()
      .then(setState)
      .catch((e) => setError(e instanceof ApiError ? e.message : "خطا در دریافت وضعیت ارز پایه"));
    fetchBaseCurrencyHistory().then(setHistory).catch(() => {});
  }, []);
  useEffect(reload, [reload]);

  if (!isOwner) {
    return (
      <Card className="p-4">
        <div className="text-[13px] font-bold text-ink mb-1">ارز پایه‌ی سیستم</div>
        <div className="text-[12.5px] text-muted">فقط مالک محیط کاری می‌تواند ارز پایه را ببیند و تغییر دهد.</div>
      </Card>
    );
  }

  const cur = state?.current;
  return (
    <>
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[13px] font-bold text-ink">ارز پایه‌ی سیستم</div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[20px] font-extrabold text-primary">{cur?.label ?? "…"}</span>
              {cur ? (
                <span dir="ltr" className="text-[12px] text-muted">
                  {cur.code}
                </span>
              ) : null}
              {state?.running ? <Badge tone="warning">تبدیل در حال اجراست</Badge> : null}
            </div>
            <p className="text-[12px] text-muted mt-2 max-w-[640px] leading-6">
              همه‌ی مبالغ ذخیره‌شده (قیمت کالا، فاکتور، پرداخت، چک، حقوق، دفتر کل و ...) به این واحد هستند. با «تغییر ارز پایه» همه‌ی این
              مبالغ با ضریب تبدیل دقیق بازمحاسبه می‌شوند (ریال ⇄ تومان: ضریب ثابت ۱۰). این یک عملیات مالی حساس است و فقط با تأیید پیامکی مالک انجام می‌شود.
            </p>
            {error ? <div className="text-[12px] text-danger mt-2">{error}</div> : null}
          </div>
          <div className="flex gap-2">
            <button className={btnPrimary} disabled={!state || !!state.running} onClick={() => setWizard({ mode: "convert" })}>
              تغییر ارز پایه
            </button>
          </div>
        </div>

        {history.length > 0 ? (
          <div className="mt-4 border-t border-border pt-3">
            <div className="text-[12px] font-bold text-ink-soft mb-2">تاریخچه‌ی تغییرها</div>
            <div className="flex flex-col gap-2">
              {history.map((h) => (
                <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-border rounded-xl px-3 py-2.5 text-[12px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <b>{h.fromLabel}</b>
                    <span>←</span>
                    <b>{h.toLabel}</b>
                    <span className="text-muted">ضریب {toPersianDigits(h.rate)}</span>
                    <Badge tone={h.status === "DONE" ? "success" : h.status === "FAILED" ? "danger" : "warning"}>{STATUS_FA[h.status] ?? h.status}</Badge>
                    {h.kind === "REVERSE" ? <Badge tone="neutral">بازگشت</Badge> : null}
                    {h.reversedById ? <Badge tone="neutral">بازگردانده شده</Badge> : null}
                  </div>
                  <div className="flex items-center gap-3 text-muted">
                    <span>{formatJalaliDateTime(new Date(h.startedAt))}</span>
                    {h.executedByName ? <span>{h.executedByName}</span> : null}
                    {state?.canReverse && state.lastConversion?.id === h.id ? (
                      <button className="text-[11.5px] font-bold text-danger bg-danger-soft px-2.5 py-1.5 rounded-lg cursor-pointer" onClick={() => setWizard({ mode: "reverse", conv: h })}>
                        بازگشت این تغییر
                      </button>
                    ) : null}
                  </div>
                  {h.errorMessage ? <div className="basis-full text-danger">{h.errorMessage}</div> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      {wizard && state ? (
        <Wizard
          state={state}
          mode={wizard.mode}
          reverseOf={wizard.mode === "reverse" ? wizard.conv : undefined}
          onClose={() => {
            setWizard(null);
            reload();
          }}
        />
      ) : null}
    </>
  );
}

function Wizard({ state, mode, reverseOf, onClose }: { state: BaseCurrencyState; mode: "convert" | "reverse"; reverseOf?: BaseCurrencyConversionSummary; onClose: () => void }) {
  const reversing = mode === "reverse";
  const others = state.presets.filter((p) => p.code !== state.current.code);
  const [step, setStep] = useState<Step>(reversing ? "preview" : "target");
  const [target, setTarget] = useState<Target>({ toCode: others[0]?.code ?? "IRR", toLabel: others[0]?.label ?? "", rate: "", custom: false });
  const [rounding, setRounding] = useState<"STRICT" | "ROUND">("STRICT");
  const [preview, setPreview] = useState<BaseCurrencyPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ack, setAck] = useState({ backup: false, lock: false, irreversible: false });
  const [phrase, setPhrase] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [convId, setConvId] = useState<string | null>(null);
  const [live, setLive] = useState<BaseCurrencyConversionSummary | null>(null);
  const [result, setResult] = useState<BaseCurrencyDetail | null>(null);
  const idemKey = useRef(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);

  // پیش‌نمایش بازگشت: ضریب معکوس و برچسب‌ها از خود عملیات اصلی می‌آید
  const input = reversing
    ? { toCode: reverseOf!.fromCode, toLabel: reverseOf!.fromLabel, roundingMode: rounding }
    : { toCode: target.toCode, toLabel: target.custom ? target.toLabel : undefined, rate: target.custom || !isPresetPair(state.current.code, target.toCode) ? target.rate : undefined, roundingMode: rounding };

  const runPreview = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const p = await previewBaseCurrency(input);
      setPreview(p);
      setStep("preview");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "پیش‌نمایش ناموفق بود");
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, rounding]);

  useEffect(() => {
    if (reversing) void runPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendCode() {
    setBusy(true);
    setErr(null);
    try {
      const r = reversing ? await requestBaseCurrencyReverseConfirmation(reverseOf!.id, { roundingMode: rounding }) : await requestBaseCurrencyConfirmation(input);
      setOtpSent(`کد تأیید به شماره‌ی ثبت‌شده‌ی شما پیامک شد (اعتبار ${toPersianDigits(Math.round(r.expiresInSeconds / 60))} دقیقه).`);
      setDevCode(r.devCode ?? null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "ارسال کد ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!preview) return;
    setBusy(true);
    setErr(null);
    try {
      const body = { idempotencyKey: idemKey.current, confirmPhrase: phrase, otp };
      const r = reversing
        ? await reverseBaseCurrency(reverseOf!.id, { ...body, roundingMode: rounding })
        : await executeBaseCurrency({ ...input, ...body });
      setConvId(r.id);
      setLive(r);
      setStep("progress");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "اجرای تبدیل ناموفق بود");
      idemKey.current = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`; // تلاش بعدی = عملیات تازه
    } finally {
      setBusy(false);
    }
  }

  // پیگیری پیشرفت تا پایان
  useEffect(() => {
    if (step !== "progress" || !convId) return;
    let stop = false;
    const tick = async () => {
      try {
        const d = await fetchBaseCurrencyConversion(convId);
        if (stop) return;
        setLive(d);
        if (d.status === "DONE" || d.status === "FAILED") {
          setResult(d);
          if (d.status === "DONE") setMoneyUnit(d.toLabel);
          setStep("result");
          return;
        }
      } catch {
        /* قطع لحظه‌ای شبکه — دوباره تلاش می‌شود */
      }
      if (!stop) setTimeout(tick, 1500);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [step, convId]);

  const toLabel = preview?.to.label ?? target.toLabel;
  const needPhrase = preview?.confirmPhrase ?? "";
  const canSubmit = !!preview?.canExecute && ack.backup && ack.lock && ack.irreversible && phrase.trim() !== "" && otp.length >= 4 && !busy;

  return (
    <Modal title={reversing ? "بازگشت تغییر ارز پایه" : "تغییر ارز پایه"} onClose={step === "progress" ? () => {} : onClose} width="max-w-[720px]">
      {step === "target" ? (
        <div className="flex flex-col gap-4">
          <div className="text-[12.5px] text-ink-soft leading-6">
            ارز پایه‌ی فعلی: <b>{state.current.label}</b>. ارز مقصد را انتخاب کنید. برای ریال ⇄ تومان ضریب ثابت <b>۱۰</b> است و خودکار اعمال می‌شود.
          </div>
          <div className="flex flex-col gap-2">
            {others.map((p) => (
              <label key={p.code} className="flex items-center gap-2 border border-border rounded-xl px-3 py-2.5 cursor-pointer">
                <input type="radio" checked={!target.custom && target.toCode === p.code} onChange={() => setTarget({ toCode: p.code, toLabel: p.label, rate: "", custom: false })} />
                <span className="text-[13px] font-bold">{p.label}</span>
                <span dir="ltr" className="text-[11.5px] text-muted">
                  {p.code}
                </span>
              </label>
            ))}
            <label className="flex items-center gap-2 border border-border rounded-xl px-3 py-2.5 cursor-pointer">
              <input type="radio" checked={target.custom} onChange={() => setTarget({ toCode: "", toLabel: "", rate: "", custom: true })} />
              <span className="text-[13px] font-bold">ارز دیگر (با نرخ تبدیل دلخواه)</span>
            </label>
          </div>
          {target.custom ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>کد ارز (مثلاً USD)</label>
                <input dir="ltr" className={inputClass} value={target.toCode} onChange={(e) => setTarget({ ...target, toCode: e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4) })} />
              </div>
              <div>
                <label className={labelClass}>عنوان نمایشی</label>
                <input className={inputClass} value={target.toLabel} onChange={(e) => setTarget({ ...target, toLabel: e.target.value })} placeholder="دلار" />
              </div>
              <div>
                <label className={labelClass}>هر ۱ {state.current.label} = چند واحد جدید؟</label>
                <input dir="ltr" className={inputClass} value={target.rate} onChange={(e) => setTarget({ ...target, rate: e.target.value.replace(/[^0-9./]/g, "") })} placeholder="0.000024" />
              </div>
              <div className="sm:col-span-3 text-[11.5px] text-warning">
                برای ارزهای غیر از ریال/تومان، مبالغ اعشاری به واحد کامل گرد می‌شوند و دقت از دست می‌رود؛ حالت «گردکردن» لازم است، درگاه پرداخت آنلاین و ارسال به مودیان برای ارز پایه‌ی غیر ریالی کار نمی‌کند. توصیه نمی‌شود.
              </div>
            </div>
          ) : null}
          <RoundingChoice value={rounding} onChange={setRounding} />
          {err ? <div className="text-[12px] text-danger">{err}</div> : null}
          <div className="flex justify-end gap-2">
            <button className={btnGhost} onClick={onClose}>
              انصراف
            </button>
            <button className={btnPrimary} disabled={busy || !target.toCode || (target.custom && (!target.toLabel || !target.rate))} onClick={runPreview}>
              {busy ? "در حال محاسبه..." : "پیش‌نمایش (بدون هیچ تغییری)"}
            </button>
          </div>
        </div>
      ) : null}

      {step === "preview" && !preview ? (
        <div className="text-[12.5px] text-muted">{busy ? "در حال محاسبه‌ی پیش‌نمایش..." : (err ?? "")}</div>
      ) : null}

      {step === "preview" && preview ? (
        <div className="flex flex-col gap-4">
          <div className="text-[13px] font-bold">
            {preview.from.label} ← {preview.to.label} <span className="text-muted font-normal">(ضریب {toPersianDigits(preview.rate)})</span>
          </div>
          {preview.blocking.length > 0 ? (
            <div className="bg-danger-soft border border-danger/30 rounded-xl p-3 text-[12px] text-danger leading-6">
              <b>تبدیل با این تنظیمات ممکن نیست:</b>
              <ul className="list-disc pr-5 mt-1">
                {preview.blocking.slice(0, 12).map((b, i) => {
                  const d = b.detail as { table?: string; column?: string; maxAbs?: string } | undefined;
                  return (
                    <li key={i}>
                      {b.message}
                      {b.code === "OVERFLOW" && d?.table ? (
                        <div className="text-[11.5px] mt-0.5">
                          جدول <b dir="ltr">{d.table}</b> — ستون <b dir="ltr">{d.column}</b> — بیشترین مقدار فعلی: <b>{d.maxAbs ? fmt(d.maxAbs) : "—"}</b>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {preview.blocking.length > 12 ? <div>و {toPersianDigits(preview.blocking.length - 12)} مورد دیگر…</div> : null}
              {preview.blocking.some((b) => b.code === "INEXACT") ? <div className="mt-1">برای ادامه، حالت «گردکردن» را انتخاب کنید (گزارش گردکردن ثبت می‌شود).</div> : null}
              {preview.blocking.some((b) => b.code === "OVERFLOW") ? (
                <div className="mt-1">سرریز: پس از ضرب در ضریب، بزرگ‌ترین مقدار از سقف ستون در پایگاه‌داده (۲٬۱۴۷٬۴۸۳٬۶۴۷ برای ستون‌های عددی معمولی) بیشتر می‌شود. تا ارتقای این ستون‌ها این تغییر برای این محیط کاری مجاز نیست؛ می‌توانید تغییر در جهت عکس (ریال به تومان) را انجام دهید یا مبلغ‌های بسیار بزرگ را بررسی کنید.</div>
              ) : null}
            </div>
          ) : (
            <div className="bg-success-soft border border-success/30 rounded-xl p-3 text-[12px] text-success">هیچ مانعی پیدا نشد؛ همه‌ی ستون‌ها در محدوده‌اند.</div>
          )}
          {preview.warnings.length > 0 ? (
            <ul className="list-disc pr-5 text-[12px] text-warning leading-6">
              {preview.warnings.map((w, i) => (
                <li key={i}>{w.message}</li>
              ))}
            </ul>
          ) : null}

          <div className="text-[12px] text-ink-soft">
            دفتر کل: جمع بدهکار {fmt(preview.ledger.totalDebit)} — جمع بستانکار {fmt(preview.ledger.totalCredit)} — اسناد نامتراز: {toPersianDigits(preview.ledger.unbalancedEntries)}
          </div>

          <div className="overflow-x-auto border border-border rounded-xl">
            <table className="w-full text-[11.5px]">
              <thead className="bg-slate-50 text-muted">
                <tr>
                  <th className="text-right p-2">جدول</th>
                  <th className="text-right p-2">ردیف</th>
                  <th className="text-right p-2">جمع مبالغ پیش از تبدیل</th>
                  <th className="text-right p-2">جمع مورد انتظار پس از تبدیل</th>
                  <th className="text-right p-2">نامضرب</th>
                </tr>
              </thead>
              <tbody>
                {preview.tables.map((t) => {
                  const sumB = t.columns.reduce((a, c) => a + BigInt(c.sumBefore), BigInt(0)).toString();
                  const sumA = t.columns.reduce((a, c) => a + BigInt(c.sumExpectedAfter), BigInt(0)).toString();
                  const lossy = t.columns.reduce((a, c) => a + c.lossy, 0);
                  if (t.rows === 0) return null;
                  return (
                    <tr key={t.table} className="border-t border-border">
                      <td className="p-2" dir="ltr">{t.table}</td>
                      <td className="p-2">{fmt(String(t.rows))}</td>
                      <td className="p-2">{fmt(sumB)}</td>
                      <td className="p-2">{fmt(sumA)}</td>
                      <td className={`p-2 ${lossy ? "text-warning font-bold" : ""}`}>{fmt(String(lossy))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {preview.samples.length > 0 ? (
            <div>
              <div className="text-[12px] font-bold text-ink-soft mb-1.5">نمونه‌ی مقدارها (بزرگ‌ترین‌ها)</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11.5px]">
                {preview.samples.slice(0, 12).map((s, i) => (
                  <div key={i} className="flex items-center justify-between bg-slate-50 border border-border rounded-lg px-2.5 py-1.5">
                    <span dir="ltr" className="text-muted">{s.table}.{s.column}</span>
                    <span>
                      {fmt(s.before)} ← <b className={s.exact ? "" : "text-warning"}>{fmt(s.after)}</b>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex justify-between gap-2">
            <button className={btnGhost} onClick={() => (reversing ? onClose() : setStep("target"))}>
              {reversing ? "انصراف" : "بازگشت"}
            </button>
            <div className="flex gap-2">
              {reversing || preview.blocking.length > 0 ? <RoundingChoice compact value={rounding} onChange={(v) => { setRounding(v); setPreview(null); void (async () => { setBusy(true); try { setPreview(await previewBaseCurrency({ ...input, roundingMode: v })); } catch (e) { setErr(e instanceof ApiError ? e.message : "خطا"); } finally { setBusy(false); } })(); }} /> : null}
              <button className={btnPrimary} disabled={!preview.canExecute} onClick={() => setStep("confirm")}>
                ادامه به تأیید
              </button>
            </div>
          </div>
          {err ? <div className="text-[12px] text-danger">{err}</div> : null}
        </div>
      ) : null}

      {step === "confirm" && preview ? (
        <div className="flex flex-col gap-4">
          <div className="bg-warning-soft border border-warning/30 rounded-xl p-3 text-[12px] text-ink leading-6">
            <b>هشدار — عملیات مالی حساس:</b>
            <ul className="list-disc pr-5 mt-1">
              <li>تمام مبالغ در همه‌ی ماژول‌ها (فاکتور، قیمت کالا، چک، حقوق، دفتر کل و ...) به {toLabel} بازمحاسبه می‌شود؛ ماه‌های بسته‌شده‌ی حسابداری هم برای یکدستی تبدیل می‌شوند.</li>
              <li>در زمان تبدیل (معمولاً چند ثانیه تا چند دقیقه) ثبت و ویرایش اسناد مالی و فرم‌های عمومی موقتاً متوقف می‌شود.</li>
              <li>مبالغ فاکتورهای ارسال‌شده به مودیان (ریال) تغییر نمی‌کنند؛ از این پس بر اساس واحد جدید محاسبه می‌شوند.</li>
              <li>برای هر ردیفی که دقیق تبدیل نشود، لاگ گردکردن ثبت می‌شود و «بازگشت» مقدارهای اصلی را برمی‌گرداند.</li>
            </ul>
          </div>
          <div className="flex flex-col gap-2 text-[12.5px]">
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={ack.backup} onChange={(e) => setAck({ ...ack, backup: e.target.checked })} className="mt-1" />
              <span>{preview.backupRequired ? "می‌دانم که پیش از تبدیل یک پشتیبان کامل از دیتابیس گرفته می‌شود و اگر پشتیبان‌گیری ناموفق باشد، هیچ تغییری انجام نمی‌شود." : "پشتیبان‌گیری خودکار در این محیط غیرفعال است؛ مسئولیت پشتیبان دستی با من است."}</span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={ack.lock} onChange={(e) => setAck({ ...ack, lock: e.target.checked })} className="mt-1" />
              <span>می‌دانم که ثبت اسناد مالی تا پایان تبدیل متوقف می‌شود و همکاران باید منتظر بمانند.</span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={ack.irreversible} onChange={(e) => setAck({ ...ack, irreversible: e.target.checked })} className="mt-1" />
              <span>می‌دانم که فقط «آخرین» تغییر قابل بازگشت است و پس از تبدیل بعدی دیگر قابل بازگشت نیست.</span>
            </label>
          </div>
          <div>
            <label className={labelClass}>
              برای تأیید دقیقاً این عبارت را تایپ کنید: <b className="text-ink">«{needPhrase}»</b>
            </label>
            <input className={inputClass} value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder={needPhrase} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={labelClass + " mb-0"}>کد تأیید پیامکی (به شماره‌ی خود مالک)</label>
              <button className="text-[11.5px] font-bold text-accent cursor-pointer disabled:opacity-50" disabled={busy} onClick={sendCode}>
                {otpSent ? "ارسال دوباره" : "ارسال کد"}
              </button>
            </div>
            <input dir="ltr" inputMode="numeric" className={inputClass} value={otp} onChange={(e) => setOtp(e.target.value.replace(/[^0-9۰-۹]/g, "").slice(0, 8))} placeholder="••••••" />
            {otpSent ? <div className="text-[11.5px] text-success mt-1">{otpSent}</div> : null}
            {devCode ? <div className="text-[11.5px] text-warning mt-1" dir="ltr">DEV code: {devCode}</div> : null}
          </div>
          {err ? <div className="text-[12px] text-danger">{err}</div> : null}
          <div className="flex justify-between gap-2">
            <button className={btnGhost} onClick={() => setStep("preview")}>
              بازگشت
            </button>
            <button className={btnPrimary + " !bg-danger"} disabled={!canSubmit || normalize(phrase) !== normalize(needPhrase)} onClick={submit}>
              {busy ? "در حال ارسال..." : reversing ? "تأیید و بازگشت تغییر" : `تأیید و تبدیل به ${toLabel}`}
            </button>
          </div>
        </div>
      ) : null}

      {step === "progress" ? (
        <div className="flex flex-col gap-3 items-stretch">
          <div className="text-[13px] font-bold">در حال تبدیل مبالغ... لطفاً صفحه را نبندید.</div>
          <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${live?.progress ? Math.round((live.progress.done / Math.max(1, live.progress.total)) * 100) : 5}%` }} />
          </div>
          <div className="text-[12px] text-muted">{live?.progress?.label ?? "پشتیبان‌گیری و آماده‌سازی..."}</div>
          <div className="text-[11.5px] text-muted">اگر ارتباط قطع شود، تبدیل در سرور یا کامل انجام می‌شود یا هیچ تغییری نمی‌ماند؛ بعداً وضعیت را در تاریخچه ببینید.</div>
        </div>
      ) : null}

      {step === "result" && result ? (
        <div className="flex flex-col gap-3">
          {result.status === "DONE" ? (
            <>
              <div className="bg-success-soft border border-success/30 rounded-xl p-3 text-[13px] text-success font-bold">
                تبدیل با موفقیت انجام شد: {result.fromLabel} ← {result.toLabel}
              </div>
              {result.report ? (
                <div className="text-[12px] text-ink-soft leading-7">
                  <div>
                    دفتر کل پس از تبدیل: بدهکار {fmt(result.report.ledgerAfter.totalDebit)} — بستانکار {fmt(result.report.ledgerAfter.totalCredit)} — اسناد نامتراز {toPersianDigits(result.report.ledgerAfter.unbalancedEntries)}
                  </div>
                  <div>
                    خانه‌های گردشده: {fmt(String(result.report.roundingTotals.cells))} — مجموع اختلاف گرد‌کردن (واحد جدید): {fmt(result.report.roundingTotals.absDiffInNewUnits)} — تعدیل تراز اسناد: {fmt(String(result.report.ledgerAdjustments))}
                  </div>
                  <div>جدول‌های دارای داده‌ی تبدیل‌شده: {fmt(String(result.report.tables.filter((t) => t.rows > 0).length))}</div>
                </div>
              ) : null}
              <div className="text-[12px] text-muted">برای اعمال برچسب جدید در همه‌ی صفحه‌ها، صفحه را دوباره بارگذاری کنید.</div>
              <div className="flex justify-end gap-2">
                <button className={btnPrimary} onClick={() => window.location.reload()}>
                  بارگذاری مجدد
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="bg-danger-soft border border-danger/30 rounded-xl p-3 text-[12.5px] text-danger leading-6">
                <b>تبدیل انجام نشد و هیچ داده‌ای تغییر نکرد.</b>
                <div>{result.errorMessage}</div>
              </div>
              <div className="flex justify-end">
                <button className={btnGhost} onClick={onClose}>
                  بستن
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

function normalize(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[‌‏‎]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPresetPair(a: string, b: string): boolean {
  return (a === "IRT" && b === "IRR") || (a === "IRR" && b === "IRT");
}

function RoundingChoice({ value, onChange, compact }: { value: "STRICT" | "ROUND"; onChange: (v: "STRICT" | "ROUND") => void; compact?: boolean }) {
  if (compact) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value as "STRICT" | "ROUND")} className="text-[12px] bg-surface border border-border rounded-xl px-2.5">
        <option value="STRICT">حالت دقیق (بدون گرد‌کردن)</option>
        <option value="ROUND">گردکردن (نیم به سمت بالا)</option>
      </select>
    );
  }
  return (
    <div className="bg-slate-50 border border-border rounded-xl p-3">
      <div className="text-[12px] font-bold text-ink-soft mb-1.5">قاعده‌ی گرد‌کردن</div>
      <label className="flex items-start gap-2 text-[12px] cursor-pointer mb-1">
        <input type="radio" checked={value === "STRICT"} onChange={() => onChange("STRICT")} className="mt-1" />
        <span>
          <b>دقیق (پیشنهادی):</b> اگر حتی یک مبلغ بر ضریب بخش‌پذیر نباشد (مثلاً ۱۲۳۴ ریال ← تومان)، عملیات انجام نمی‌شود.
        </span>
      </label>
      <label className="flex items-start gap-2 text-[12px] cursor-pointer">
        <input type="radio" checked={value === "ROUND"} onChange={() => onChange("ROUND")} className="mt-1" />
        <span>
          <b>گردکردن:</b> نیم به سمت دور از صفر؛ اسناد دفتر کل با تعدیل یک سطر تراز می‌مانند، همه‌ی تغییرها لاگ می‌شود و «بازگشت» مقدار اصلی را دقیق برمی‌گرداند.
        </span>
      </label>
    </div>
  );
}
