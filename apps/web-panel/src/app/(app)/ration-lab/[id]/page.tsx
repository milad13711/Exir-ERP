"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatJalaliDate, formatJalaliDateTime, formatToman } from "@/lib/persian";
import {
  fetchRationSample,
  fetchRationSampleTrend,
  completeRationFollowUp,
  rationSamplePdfUrl,
  markRationSampleInTransit,
  updateRationSample,
  deleteRationSample,
  type RationSample,
  type RationTrendPoint,
  ApiError,
} from "@/lib/api";

const STATUS_LABELS: Record<RationSample["status"], string> = {
  COLLECTED: "جمع‌آوری اولیه",
  IN_TRANSIT: "انتقال به آزمایشگاه",
  LAB_CONFIRMED: "تأیید تحویل آزمایشگاه",
  REPORT_SUBMITTED: "ثبت نظر متخصص",
  SENT_TO_EXPERT: "ارسال‌شده برای کارشناس",
  VIEWED_BY_FARMER: "رویت‌شده توسط دامدار",
};
const STATUS_TONES: Record<RationSample["status"], "warning" | "primary" | "success" | "neutral" | "accent"> = {
  COLLECTED: "neutral",
  IN_TRANSIT: "warning",
  LAB_CONFIRMED: "accent",
  REPORT_SUBMITTED: "primary",
  SENT_TO_EXPERT: "primary",
  VIEWED_BY_FARMER: "success",
};
const EDITABLE_STATUSES = new Set<RationSample["status"]>(["COLLECTED", "IN_TRANSIT"]);

type EditLine = { ingredientName: string; quantityPerAnimalKg: string; unitCostSnapshot: string };

export default function RationSampleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [sample, setSample] = useState<RationSample | null>(null);
  const [trend, setTrend] = useState<RationTrendPoint[]>([]);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState(false);
  const [herdSize, setHerdSize] = useState("");
  const [totalHerdMilkYieldLiters, setTotalHerdMilkYieldLiters] = useState("");
  const [avgMilkYieldPerAnimalLiters, setAvgMilkYieldPerAnimalLiters] = useState("");
  const [milkFatPercent, setMilkFatPercent] = useState("");
  const [milkProteinPercent, setMilkProteinPercent] = useState("");
  const [currentRationDescription, setCurrentRationDescription] = useState("");
  const [editLines, setEditLines] = useState<EditLine[]>([]);
  const [analysisFeeAmount, setAnalysisFeeAmount] = useState("");
  const [discountCode, setDiscountCode] = useState("");

  function reload() {
    fetchRationSample(id).then(setSample).catch(() => setSample(null));
    fetchRationSampleTrend(id).then(setTrend).catch(() => setTrend([]));
  }
  useEffect(reload, [id]);

  if (!sample) return <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>;

  const currentLines = sample.lines.filter((l) => l.kind === "CURRENT");
  const proposedLines = sample.lines.filter((l) => l.kind === "PROPOSED");
  const currentTotal = currentLines.reduce((s, l) => s + l.lineCost, 0);
  const proposedTotal = proposedLines.reduce((s, l) => s + l.lineCost, 0);
  const maxMilk = Math.max(1, ...trend.map((t) => t.avgMilkYieldPerAnimalLiters ?? 0));
  const canEdit = EDITABLE_STATUSES.has(sample.status);

  function startEdit() {
    setHerdSize(sample!.herdSize != null ? String(sample!.herdSize) : "");
    setTotalHerdMilkYieldLiters(sample!.totalHerdMilkYieldLiters ?? "");
    setAvgMilkYieldPerAnimalLiters(sample!.avgMilkYieldPerAnimalLiters ?? "");
    setMilkFatPercent(sample!.milkFatPercent ?? "");
    setMilkProteinPercent(sample!.milkProteinPercent ?? "");
    setCurrentRationDescription(sample!.currentRationDescription ?? "");
    setEditLines(
      currentLines.map((l) => ({
        ingredientName: l.ingredientName,
        quantityPerAnimalKg: l.quantityPerAnimalKg,
        unitCostSnapshot: String(l.unitCostSnapshot),
      })),
    );
    setAnalysisFeeAmount(String(sample!.analysisFeeAmount));
    setDiscountCode(sample!.discountCode ?? "");
    setEditing(true);
  }

  async function handleSaveEdit() {
    setError(null);
    setBusy(true);
    try {
      const validLines = editLines.filter((l) => l.ingredientName.trim() && l.quantityPerAnimalKg && l.unitCostSnapshot);
      await updateRationSample(id, {
        herdSize: herdSize ? Number(herdSize) : undefined,
        totalHerdMilkYieldLiters: totalHerdMilkYieldLiters ? Number(totalHerdMilkYieldLiters) : undefined,
        avgMilkYieldPerAnimalLiters: avgMilkYieldPerAnimalLiters ? Number(avgMilkYieldPerAnimalLiters) : undefined,
        milkFatPercent: milkFatPercent ? Number(milkFatPercent) : undefined,
        milkProteinPercent: milkProteinPercent ? Number(milkProteinPercent) : undefined,
        currentRationDescription: currentRationDescription || undefined,
        currentLines: validLines.length
          ? validLines.map((l) => ({
              ingredientName: l.ingredientName,
              quantityPerAnimalKg: Number(l.quantityPerAnimalKg),
              unitCostSnapshot: Number(l.unitCostSnapshot),
            }))
          : undefined,
        analysisFeeAmount: analysisFeeAmount ? Number(analysisFeeAmount) : undefined,
        discountCode: discountCode || undefined,
      });
      setEditing(false);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ویرایش نمونه با خطا مواجه شد");
    } finally {
      setBusy(false);
    }
  }

  async function handleMarkInTransit() {
    setBusy(true);
    setError(null);
    try {
      await markRationSampleInTransit(id);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت انتقال با خطا مواجه شد");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`نمونه‌ی #${sample!.sampleNo} حذف شود؟ این عمل غیرقابل بازگشت است.`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteRationSample(id);
      router.push("/ration-lab");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "حذف نمونه با خطا مواجه شد");
      setBusy(false);
    }
  }

  async function handleCompleteFollowUp(followUpId: string, form: HTMLFormElement) {
    setError(null);
    const fd = new FormData(form);
    setCompletingId(followUpId);
    try {
      const num = (key: string) => {
        const v = fd.get(key);
        return v && String(v).trim() ? Number(v) : undefined;
      };
      await completeRationFollowUp(followUpId, {
        herdSize: num("herdSize"),
        totalHerdMilkYieldLiters: num("totalHerdMilkYieldLiters"),
        avgMilkYieldPerAnimalLiters: num("avgMilkYieldPerAnimalLiters"),
        milkFatPercent: num("milkFatPercent"),
        milkProteinPercent: num("milkProteinPercent"),
        notes: String(fd.get("notes") ?? "") || undefined,
      });
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت پیگیری با خطا مواجه شد");
    } finally {
      setCompletingId(null);
    }
  }

  return (
    <div className="p-5 lg:p-7 max-w-[900px] mx-auto flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-extrabold" dir="ltr">
              #{sample.sampleNo}
            </h1>
            <Badge tone={STATUS_TONES[sample.status]}>{STATUS_LABELS[sample.status]}</Badge>
          </div>
          <p className="text-[13.5px] text-muted mt-1">
            {sample.contact.name} · {formatJalaliDate(sample.collectedAt)}
            {sample.collectedBy ? ` · ثبت‌شده توسط ${sample.collectedBy.name}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {sample.status === "COLLECTED" ? (
            <button
              onClick={handleMarkInTransit}
              disabled={busy}
              className="px-4 py-2.5 rounded-xl border border-border text-[12.5px] font-bold disabled:opacity-50"
            >
              ارسال به آزمایشگاه
            </button>
          ) : null}
          {canEdit && !editing ? (
            <button onClick={startEdit} className="px-4 py-2.5 rounded-xl border border-border text-[12.5px] font-bold">
              ویرایش
            </button>
          ) : null}
          {canEdit ? (
            <button onClick={handleDelete} disabled={busy} className="px-4 py-2.5 rounded-xl border border-danger/30 text-danger text-[12.5px] font-bold disabled:opacity-50">
              حذف نمونه
            </button>
          ) : null}
          {sample.labReport ? (
            <a
              href={rationSamplePdfUrl(sample.id)}
              target="_blank"
              rel="noopener"
              className="px-4 py-2.5 rounded-xl border border-border text-[12.5px] font-bold"
            >
              دانلود/چاپ گزارش
            </a>
          ) : null}
        </div>
      </div>

      {error ? <div className="text-[12.5px] text-danger font-semibold">{error}</div> : null}

      {editing ? (
        <Card className="p-5 flex flex-col gap-4">
          <div className="text-[14px] font-extrabold">ویرایش اطلاعات نمونه</div>
          <div className="grid sm:grid-cols-2 gap-3">
            <EditField label="تعداد دام گله" value={herdSize} onChange={setHerdSize} />
            <EditField label="میزان کل شیر گله (لیتر)" value={totalHerdMilkYieldLiters} onChange={setTotalHerdMilkYieldLiters} />
            <EditField label="میانگین شیر هر راس (لیتر)" value={avgMilkYieldPerAnimalLiters} onChange={setAvgMilkYieldPerAnimalLiters} />
            <EditField label="درصد چربی شیر" value={milkFatPercent} onChange={setMilkFatPercent} />
            <EditField label="درصد پروتئین شیر" value={milkProteinPercent} onChange={setMilkProteinPercent} />
            <EditField label="هزینه‌ی آنالیز (تومان)" value={analysisFeeAmount} onChange={setAnalysisFeeAmount} />
          </div>
          <div>
            <label className="block text-[13px] font-semibold mb-2">توضیح جیره‌ی فعلی</label>
            <textarea
              value={currentRationDescription}
              onChange={(e) => setCurrentRationDescription(e.target.value)}
              rows={3}
              className="w-full px-4 py-3 rounded-xl border-2 border-border focus:border-primary outline-none text-[13px]"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[13px] font-semibold">خطوط جیره‌ی فعلی</label>
              <button
                type="button"
                onClick={() => setEditLines((prev) => [...prev, { ingredientName: "", quantityPerAnimalKg: "", unitCostSnapshot: "" }])}
                className="text-[12px] font-bold text-primary"
              >
                + افزودن ماده
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {editLines.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_100px_120px_auto] gap-2">
                  <input
                    placeholder="نام ماده"
                    value={l.ingredientName}
                    onChange={(e) => setEditLines((prev) => prev.map((row, idx) => (idx === i ? { ...row, ingredientName: e.target.value } : row)))}
                    className="px-3 py-2 rounded-lg border border-border text-[12.5px]"
                  />
                  <input
                    placeholder="کیلو/دام"
                    dir="ltr"
                    value={l.quantityPerAnimalKg}
                    onChange={(e) => setEditLines((prev) => prev.map((row, idx) => (idx === i ? { ...row, quantityPerAnimalKg: e.target.value } : row)))}
                    className="px-3 py-2 rounded-lg border border-border text-[12.5px]"
                  />
                  <input
                    placeholder="قیمت هر کیلو"
                    dir="ltr"
                    value={l.unitCostSnapshot}
                    onChange={(e) => setEditLines((prev) => prev.map((row, idx) => (idx === i ? { ...row, unitCostSnapshot: e.target.value } : row)))}
                    className="px-3 py-2 rounded-lg border border-border text-[12.5px]"
                  />
                  <button type="button" onClick={() => setEditLines((prev) => prev.filter((_, idx) => idx !== i))} className="text-danger text-[12px] font-bold">
                    حذف
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[13px] font-semibold mb-2">کد تخفیف</label>
            <input
              value={discountCode}
              onChange={(e) => setDiscountCode(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border-2 border-border focus:border-primary outline-none text-[13px]"
              dir="ltr"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveEdit}
              disabled={busy}
              className="flex-1 py-3 rounded-xl bg-primary text-white text-[13.5px] font-bold disabled:opacity-50"
            >
              {busy ? "در حال ذخیره..." : "ذخیره‌ی تغییرات"}
            </button>
            <button onClick={() => setEditing(false)} className="px-5 py-3 rounded-xl border border-border text-[13px] font-bold">
              انصراف
            </button>
          </div>
        </Card>
      ) : (
        <Card className="p-5">
          <div className="text-[14px] font-extrabold mb-3">معیارهای گله در روز نمونه‌برداری</div>
          <div className="grid sm:grid-cols-3 gap-3">
            <Metric label="تعداد دام" value={sample.herdSize} />
            <Metric label="کل شیر گله (لیتر)" value={sample.totalHerdMilkYieldLiters} />
            <Metric label="میانگین هر دام (لیتر)" value={sample.avgMilkYieldPerAnimalLiters} />
            <Metric label="چربی (٪)" value={sample.milkFatPercent} />
            <Metric label="پروتئین (٪)" value={sample.milkProteinPercent} />
            <Metric label="هزینه‌ی آنالیز" value={formatToman(sample.finalFeeAmount)} raw />
          </div>
          {sample.currentRationDescription ? (
            <p className="text-[13px] text-ink-soft leading-relaxed mt-4 bg-slate-50 border border-border rounded-xl p-4">
              {sample.currentRationDescription}
            </p>
          ) : null}
        </Card>
      )}

      {sample.labReport ? (
        <Card className="p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="text-[14px] font-extrabold">گزارش آزمایشگاه</div>
            <div className="text-[11.5px] text-muted">
              ثبت‌شده در {formatJalaliDateTime(sample.labReport.submittedAt)}
              {sample.labReport.reviewedByName ? ` · ${sample.labReport.reviewedByName}` : ""}
            </div>
          </div>
          <ReportBlock label="ایرادات جیره‌ی فعلی" text={sample.labReport.currentRationIssues} />
          <ReportBlock label="ریسک عدم تغییر" text={sample.labReport.riskIfUnchanged} />
          <ReportBlock label="توصیه‌های جدید" text={sample.labReport.newRecommendations} />
          <ReportBlock label="نتیجه‌ی قابل انتظار" text={sample.labReport.expectedResult} />
          <ReportBlock label="در صورت مشاهده‌ی موارد زیر فوراً اطلاع دهید" text={sample.labReport.urgentWarningSigns} tone="warn" />

          <div>
            <div className="text-[13px] font-bold mb-2">مقایسه‌ی اقتصادی جیره (به‌ازای هر دام)</div>
            <div className="grid sm:grid-cols-2 gap-4">
              <RationLinesTable title="جیره‌ی فعلی" lines={currentLines} />
              <RationLinesTable title="جیره‌ی پیشنهادی" lines={proposedLines} />
            </div>
            <div className="grid sm:grid-cols-3 gap-3 mt-3">
              <Metric label="هزینه‌ی فعلی" value={formatToman(currentTotal)} raw />
              <Metric label="هزینه‌ی پیشنهادی" value={formatToman(proposedTotal)} raw />
              <Metric
                label={proposedTotal - currentTotal <= 0 ? "صرفه‌جویی" : "افزایش هزینه"}
                value={formatToman(Math.abs(proposedTotal - currentTotal))}
                raw
              />
            </div>
          </div>
        </Card>
      ) : (
        <Card className="p-5 text-center text-[13px] text-muted">
          {sample.status === "COLLECTED" || sample.status === "IN_TRANSIT"
            ? <>هنوز نمونه به آزمایشگاه تحویل نشده — شماره‌ی نمونه <b dir="ltr">#{sample.sampleNo}</b> را به کارشناس آزمایشگاه بدهید.</>
            : <>هنوز گزارشی از آزمایشگاه ثبت نشده — شماره‌ی نمونه <b dir="ltr">#{sample.sampleNo}</b> را به کارشناس آزمایشگاه بدهید.</>}
        </Card>
      )}

      {trend.length > 1 ? (
        <Card className="p-5">
          <div className="text-[14px] font-extrabold mb-4">روند میانگین شیر هر دام</div>
          <div className="flex items-end gap-4 h-40 px-1">
            {trend.map((t, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-2">
                <span className="text-[11px] font-bold">{t.avgMilkYieldPerAnimalLiters ?? "—"}</span>
                <div
                  className={`w-full rounded-t-[8px] ${i === trend.length - 1 ? "bg-primary" : "bg-primary-soft"}`}
                  style={{ height: `${((t.avgMilkYieldPerAnimalLiters ?? 0) / maxMilk) * 120}px` }}
                />
                <span className="text-[10.5px] text-muted text-center">{t.label}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {sample.followUps.length > 0 ? (
        <Card className="p-5">
          <div className="text-[14px] font-extrabold mb-4">پیگیری‌ها</div>
          <div className="flex flex-col gap-3">
            {sample.followUps.map((f) => (
              <div key={f.id} className="border border-border rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[13px] font-bold">{f.dueOffsetDays} روز بعد</span>
                  <span className="text-[11.5px] text-muted">
                    {f.completedAt ? `تکمیل‌شده در ${formatJalaliDate(f.completedAt)}` : `سررسید ${formatJalaliDate(f.scheduledAt)}`}
                  </span>
                </div>
                {f.completedAt ? (
                  <div className="grid sm:grid-cols-3 gap-2 text-[12px] text-ink-soft">
                    <Metric label="تعداد دام" value={f.herdSize} small />
                    <Metric label="کل شیر گله" value={f.totalHerdMilkYieldLiters} small />
                    <Metric label="میانگین هر دام" value={f.avgMilkYieldPerAnimalLiters} small />
                  </div>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleCompleteFollowUp(f.id, e.currentTarget);
                    }}
                    className="grid sm:grid-cols-3 gap-2"
                  >
                    <input name="herdSize" placeholder="تعداد دام" className="px-3 py-2 rounded-lg border border-border text-[12px]" dir="ltr" />
                    <input name="totalHerdMilkYieldLiters" placeholder="کل شیر گله" className="px-3 py-2 rounded-lg border border-border text-[12px]" dir="ltr" />
                    <input name="avgMilkYieldPerAnimalLiters" placeholder="میانگین هر دام" className="px-3 py-2 rounded-lg border border-border text-[12px]" dir="ltr" />
                    <input name="milkFatPercent" placeholder="چربی ٪" className="px-3 py-2 rounded-lg border border-border text-[12px]" dir="ltr" />
                    <input name="milkProteinPercent" placeholder="پروتئین ٪" className="px-3 py-2 rounded-lg border border-border text-[12px]" dir="ltr" />
                    <input name="notes" placeholder="یادداشت" className="px-3 py-2 rounded-lg border border-border text-[12px]" />
                    <button
                      type="submit"
                      disabled={completingId === f.id}
                      className="sm:col-span-3 py-2 rounded-lg bg-primary text-white text-[12.5px] font-bold disabled:opacity-50"
                    >
                      {completingId === f.id ? "در حال ثبت..." : "تکمیل این پیگیری"}
                    </button>
                  </form>
                )}
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function EditField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[13px] font-semibold mb-2">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        dir="ltr"
        className="w-full px-4 py-3 rounded-xl border-2 border-border focus:border-primary outline-none text-[13px]"
      />
    </div>
  );
}

function Metric({ label, value, raw, small }: { label: string; value: string | number | null | undefined; raw?: boolean; small?: boolean }) {
  return (
    <div className={`bg-slate-50 border border-border rounded-xl ${small ? "p-2.5" : "p-3.5"}`}>
      <div className="text-[10.5px] text-muted">{label}</div>
      <div className={`font-bold mt-0.5 ${small ? "text-[12px]" : "text-[14px]"}`}>{value == null || value === "" ? "—" : raw ? value : value}</div>
    </div>
  );
}

function ReportBlock({ label, text, tone }: { label: string; text: string; tone?: "warn" }) {
  return (
    <div>
      <div className="text-[12px] font-bold text-muted mb-1.5">{label}</div>
      <div className={`text-[13px] leading-relaxed rounded-xl p-4 border ${tone === "warn" ? "bg-danger-soft border-danger/20 text-danger font-semibold" : "bg-slate-50 border-border text-ink-soft"}`}>
        {text}
      </div>
    </div>
  );
}

function RationLinesTable({ title, lines }: { title: string; lines: RationSample["lines"] }) {
  return (
    <div>
      <div className="text-[12.5px] font-bold mb-1.5">{title}</div>
      {lines.length === 0 ? (
        <div className="text-[12px] text-muted">ثبت نشده</div>
      ) : (
        <div className="overflow-x-auto"><table className="w-full text-[11.5px] border-collapse min-w-[420px]">
          <thead>
            <tr className="border-b border-border">
              <th className="text-right py-1.5 font-semibold text-muted">ماده</th>
              <th className="text-right py-1.5 font-semibold text-muted">مقدار</th>
              <th className="text-right py-1.5 font-semibold text-muted">هزینه</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-b-0">
                <td className="py-1.5">{l.ingredientName}</td>
                <td className="py-1.5" dir="ltr">
                  {l.quantityPerAnimalKg}
                </td>
                <td className="py-1.5" dir="ltr">
                  {formatToman(l.lineCost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}
