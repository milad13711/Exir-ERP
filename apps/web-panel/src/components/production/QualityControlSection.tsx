import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { formatJalaliDateTime } from "@/lib/persian";
import {
  fetchSamples,
  createSample,
  fetchTestTypes,
  createTestType,
  addSampleResult,
  ApiError,
  type QualitySample,
  type QualityTestType,
  type QualityVerdict,
} from "@/lib/api";
import { ExcelImportExportBar } from "@/components/shared/ExcelImportExportBar";

const VERDICT_LABELS: Record<QualityVerdict, string> = { PENDING: "در انتظار نتیجه", PASS: "قبول", FAIL: "رد" };
const VERDICT_TONES: Record<QualityVerdict, "success" | "danger" | "neutral"> = { PENDING: "neutral", PASS: "success", FAIL: "danger" };
const inputClass =
  "text-[12px] bg-surface border border-border rounded-lg px-2.5 py-2 outline-none min-w-0";

export function QualityControlSection({ productionOrderId }: { productionOrderId: string }) {
  const [samples, setSamples] = useState<QualitySample[] | null>(null);
  const [testTypes, setTestTypes] = useState<QualityTestType[]>([]);
  const [addingSample, setAddingSample] = useState(false);
  const [source, setSource] = useState<"IN_PROCESS" | "FINAL_PRODUCT">("FINAL_PRODUCT");
  const [error, setError] = useState<string | null>(null);
  const [resultForm, setResultForm] = useState<Record<string, { testTypeId: string; measuredValue: string }>>({});
  const [newTestTypeOpen, setNewTestTypeOpen] = useState(false);
  const [ttName, setTtName] = useState("");
  const [ttUnit, setTtUnit] = useState("");
  const [ttMin, setTtMin] = useState("");
  const [ttMax, setTtMax] = useState("");

  function reload() {
    fetchSamples(productionOrderId).then(setSamples).catch(() => setSamples([]));
  }
  useEffect(() => {
    reload();
    fetchTestTypes().then(setTestTypes).catch(() => setTestTypes([]));
  }, [productionOrderId]);

  async function handleAddSample() {
    setError(null);
    try {
      await createSample({ productionOrderId, source });
      setAddingSample(false);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    }
  }

  async function handleAddResult(sampleId: string) {
    const form = resultForm[sampleId];
    if (!form?.testTypeId || !form.measuredValue) return;
    setError(null);
    try {
      await addSampleResult(sampleId, { testTypeId: form.testTypeId, measuredValue: Number(form.measuredValue) });
      setResultForm((prev) => ({ ...prev, [sampleId]: { testTypeId: "", measuredValue: "" } }));
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    }
  }

  async function handleCreateTestType() {
    if (!ttName.trim() || !ttUnit.trim()) return;
    try {
      const created = await createTestType({
        name: ttName.trim(),
        unit: ttUnit.trim(),
        acceptableMin: ttMin ? Number(ttMin) : undefined,
        acceptableMax: ttMax ? Number(ttMax) : undefined,
      });
      setTestTypes((prev) => [...prev, created]);
      setNewTestTypeOpen(false);
      setTtName("");
      setTtUnit("");
      setTtMin("");
      setTtMax("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[13px] font-bold">کنترل کیفیت</div>
        <button
          onClick={() => setAddingSample((v) => !v)}
          className="text-[11.5px] font-bold text-primary cursor-pointer"
        >
          + نمونه جدید
        </button>
      </div>

      {addingSample ? (
        <div className="bg-slate-50 border border-border rounded-xl p-3 mb-3 flex items-center gap-2 flex-wrap">
          <select value={source} onChange={(e) => setSource(e.target.value as never)} className={inputClass}>
            <option value="FINAL_PRODUCT">نمونه از محصول نهایی</option>
            <option value="IN_PROCESS">نمونه از میانه‌ی تولید</option>
          </select>
          <button onClick={handleAddSample} className="text-[11.5px] font-bold text-white bg-primary px-3 py-2 rounded-lg cursor-pointer">
            ثبت نمونه
          </button>
        </div>
      ) : null}

      {error ? <div className="text-[11.5px] text-danger mb-2">{error}</div> : null}

      {samples === null ? (
        <div className="text-muted text-[12px] py-2">در حال بارگذاری...</div>
      ) : samples.length === 0 ? (
        <div className="text-muted text-[12px] py-2">هنوز نمونه‌ای ثبت نشده است</div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {samples.map((s) => (
            <div key={s.id} className="bg-slate-50 border border-border rounded-xl p-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="text-[12px] font-semibold">
                  {s.source === "FINAL_PRODUCT" ? "محصول نهایی" : "میانه‌ی تولید"}
                  <span className="text-muted font-normal"> — {formatJalaliDateTime(s.sampledAt)}</span>
                </div>
                <Badge tone={VERDICT_TONES[s.verdict]}>{VERDICT_LABELS[s.verdict]}</Badge>
              </div>
              {s.results.length > 0 ? (
                <div className="mt-2 flex flex-col gap-1">
                  {s.results.map((r) => (
                    <div key={r.id} className="flex items-center justify-between text-[11.5px]">
                      <span>{r.testType.name}</span>
                      <span className={r.verdict === "FAIL" ? "text-danger font-bold" : "font-bold"}>
                        {r.measuredValue}
                        {r.testType.unit}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="flex items-center gap-2 flex-wrap mt-2.5">
                <select
                  value={resultForm[s.id]?.testTypeId ?? ""}
                  onChange={(e) => setResultForm((prev) => ({ ...prev, [s.id]: { testTypeId: e.target.value, measuredValue: prev[s.id]?.measuredValue ?? "" } }))}
                  className={inputClass}
                >
                  <option value="">نوع آزمون...</option>
                  {testTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <input
                  value={resultForm[s.id]?.measuredValue ?? ""}
                  onChange={(e) =>
                    setResultForm((prev) => ({ ...prev, [s.id]: { testTypeId: prev[s.id]?.testTypeId ?? "", measuredValue: e.target.value } }))
                  }
                  placeholder="مقدار اندازه‌گیری‌شده"
                  dir="ltr"
                  inputMode="decimal"
                  className={`${inputClass} w-32`}
                />
                <button
                  onClick={() => handleAddResult(s.id)}
                  className="text-[11.5px] font-bold text-white bg-primary px-3 py-2 rounded-lg cursor-pointer"
                >
                  ثبت نتیجه
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {newTestTypeOpen ? (
        <div className="bg-slate-50 border border-border rounded-xl p-3 mt-3 flex items-center gap-2 flex-wrap">
          <input value={ttName} onChange={(e) => setTtName(e.target.value)} placeholder="نام آزمون" className={inputClass} />
          <input value={ttUnit} onChange={(e) => setTtUnit(e.target.value)} placeholder="واحد" className={`${inputClass} w-20`} dir="ltr" />
          <input value={ttMin} onChange={(e) => setTtMin(e.target.value)} placeholder="حداقل" className={`${inputClass} w-24`} dir="ltr" inputMode="decimal" />
          <input value={ttMax} onChange={(e) => setTtMax(e.target.value)} placeholder="حداکثر" className={`${inputClass} w-24`} dir="ltr" inputMode="decimal" />
          <button onClick={handleCreateTestType} className="text-[11.5px] font-bold text-white bg-primary px-3 py-2 rounded-lg cursor-pointer">
            ذخیره
          </button>
        </div>
      ) : (
        <button onClick={() => setNewTestTypeOpen(true)} className="text-[11px] text-muted mt-2 cursor-pointer">
          + تعریف نوع آزمون جدید
        </button>
      )}

      <div className="mt-3">
        <ExcelImportExportBar
          exportPath="/quality-control/test-types/export"
          exportFilename="test-types.xlsx"
          importPath="/quality-control/test-types/import"
          templatePath="/quality-control/test-types/template"
          templateFilename="test-types-template.xlsx"
          onImported={() => fetchTestTypes().then(setTestTypes).catch(() => {})}
        />
      </div>
    </div>
  );
}
