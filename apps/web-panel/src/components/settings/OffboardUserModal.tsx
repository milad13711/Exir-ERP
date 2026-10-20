"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CloseIcon } from "@/components/icons";
import { Badge } from "@/components/ui/Badge";
import { toPersianDigits } from "@/lib/persian";
import {
  ApiError,
  downloadOffboardingCsv,
  dryRunOffboarding,
  fetchOffboardingPreview,
  offboardUser,
  type OffboardingMode,
  type OffboardingPreview,
  type OffboardingRequest,
  type OffboardingResult,
  type TenantUser,
} from "@/lib/api";
import { UserCombobox } from "./offboarding/UserCombobox";

const REASON_LABELS: Record<string, string> = {
  manager: "مدیر مستقیم",
  "department-manager": "مدیر واحد",
  "same-role": "هم‌نقش",
  owner: "مدیر کل",
};

type Step = 1 | 2 | 3 | 4;

const STEP_TITLES: Record<Step, string> = { 1: "رکوردهای کاربر", 2: "انتخاب مقصد", 3: "بازبینی و تأیید", 4: "گزارش نهایی" };

/**
 * «حذف کاربر و انتقال رکوردها» (flow = "offboard") و «انتقال رکوردها بدون حذف» (flow = "transfer").
 * ۴ مرحله: پیش‌نمایش ← مقصد ← بازبینی (dry-run واقعی) ← گزارش. روی موبایل bottom-sheet است.
 * هیچ undo ای وجود ندارد؛ به‌جایش CSV شناسه‌ها برای بازگردانی دستی دانلود می‌شود.
 */
export function OffboardUserModal({
  user,
  users,
  flow,
  actorRole,
  onClose,
  onDone,
}: {
  user: TenantUser;
  users: TenantUser[];
  flow: "offboard" | "transfer";
  actorRole: string | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const transferOnly = flow === "transfer";
  const canDeleteFully = actorRole === "OWNER";
  const [step, setStep] = useState<Step>(1);
  const [preview, setPreview] = useState<OffboardingPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [target, setTarget] = useState("");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<"deactivate" | "delete">("deactivate");
  const [notifyManager, setNotifyManager] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [accept, setAccept] = useState(false);

  const [dry, setDry] = useState<OffboardingResult | null>(null);
  const [dryError, setDryError] = useState<string | null>(null);
  const [dryLoading, setDryLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [result, setResult] = useState<OffboardingResult | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const mode: OffboardingMode = transferOnly ? "transfer-only" : outcome;

  useEffect(() => {
    let alive = true;
    fetchOffboardingPreview(user.id, transferOnly ? "transfer-only" : "deactivate")
      .then((p) => {
        if (!alive) return;
        setPreview(p);
        const first = p.suggestedTargets[0];
        if (first) setTarget(first.userId);
      })
      .catch((err) => alive && setLoadError(err instanceof ApiError ? err.message : "دریافت اطلاعات ناموفق بود"));
    return () => {
      alive = false;
    };
  }, [user.id, transferOnly]);

  // Esc بستن، و تله‌ی Tab داخل دیالوگ (دسترس‌پذیری صفحه‌کلید)
  useEffect(() => {
    const node = dialogRef.current;
    node?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !running) {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const focusables = node.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, running]);

  const candidates = useMemo(
    () => users.filter((u) => u.id !== user.id && u.status === "ACTIVE").map((u) => ({ id: u.id, name: u.name, phone: u.phone })),
    [users, user.id],
  );
  const suggestedIds = preview?.suggestedTargets.map((s) => s.userId) ?? [];
  const suggestionLabels = useMemo(() => Object.fromEntries((preview?.suggestedTargets ?? []).map((s) => [s.userId, REASON_LABELS[s.reason] ?? ""])), [preview]);
  const nameOf = useCallback((id: string) => users.find((u) => u.id === id)?.name ?? "—", [users]);

  const hasRecords = (preview?.totalOwned ?? 0) > 0;
  const moduleCodes = preview?.modules.map((m) => m.moduleCode) ?? [];
  const uncoveredModules = moduleCodes.filter((c) => !overrides[c]);
  const targetRequired = hasRecords && uncoveredModules.length > 0;
  const blocked = (preview?.blockingIssues.length ?? 0) > 0;

  function buildRequest(acceptAccess: boolean): OffboardingRequest {
    const clean = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v));
    return {
      transferToUserId: target || undefined,
      perModuleOverrides: Object.keys(clean).length ? clean : undefined,
      mode,
      reason: reason.trim() || undefined,
      acceptTargetWithoutAccess: acceptAccess || undefined,
      notifyManager: notifyManager || undefined,
    };
  }

  async function goReview() {
    setStep(3);
    await loadDry();
  }

  async function loadDry(forMode: OffboardingMode = mode) {
    setDryLoading(true);
    setDryError(null);
    setAccept(false);
    try {
      setDry(await dryRunOffboarding(user.id, { ...buildRequest(false), mode: forMode }));
    } catch (err) {
      setDry(null);
      setDryError(err instanceof ApiError ? err.message : "محاسبه‌ی پیش‌نمایش ناموفق بود");
    } finally {
      setDryLoading(false);
    }
  }

  // با تغییر روش (غیرفعال/حذف) شمارش پاک‌سازی تغییر می‌کند
  const lastModeRef = useRef(mode);
  useEffect(() => {
    if (step === 3 && lastModeRef.current !== mode) void loadDry(mode);
    lastModeRef.current = mode;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, step]);

  const nameMatches = transferOnly || confirmName.trim() === user.name.trim();
  const needsAccept = dry?.requiresAcceptance ?? false;
  const canRun = !!dry && !dryLoading && nameMatches && (!needsAccept || accept) && !running;

  async function run() {
    setRunning(true);
    setRunError(null);
    try {
      const res = await offboardUser(user.id, buildRequest(accept));
      setResult(res);
      setStep(4);
    } catch (err) {
      setRunError(err instanceof ApiError ? err.message : "اجرا ناموفق بود");
    } finally {
      setRunning(false);
    }
  }

  async function downloadCsv() {
    if (!result?.runId) return;
    setCsvError(null);
    try {
      await downloadOffboardingCsv(result.runId);
    } catch (err) {
      setCsvError(err instanceof ApiError ? err.message : "دانلود گزارش ناموفق بود");
    }
  }

  const title = transferOnly ? `انتقال رکوردها — ${user.name}` : `حذف کاربر و انتقال رکوردها — ${user.name}`;
  const inputCls = "w-full px-3 min-h-11 rounded-[10px] border border-border text-base outline-none focus:border-primary bg-white";
  const btnPrimary = "min-h-11 px-5 rounded-xl bg-primary text-white text-[14px] font-bold disabled:opacity-50 cursor-pointer";
  const btnGhost = "min-h-11 px-4 rounded-xl border border-border text-[14px] font-bold cursor-pointer disabled:opacity-50";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/40 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && !running && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="offboard-title"
        tabIndex={-1}
        className="bg-surface w-full sm:max-w-[640px] rounded-t-2xl sm:rounded-2xl border border-border shadow-xl max-h-[92dvh] sm:max-h-[calc(100dvh-2rem)] flex flex-col outline-none"
      >
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-border shrink-0">
          <div className="min-w-0">
            <h2 id="offboard-title" className="text-[15px] font-extrabold truncate">
              {title}
            </h2>
            <p className="text-[12px] text-muted mt-0.5">
              مرحله {toPersianDigits(step)} از {toPersianDigits(4)} — {STEP_TITLES[step]}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={running} aria-label="بستن" className="w-11 h-11 rounded-lg flex items-center justify-center text-muted hover:bg-primary-soft hover:text-primary cursor-pointer shrink-0">
            <CloseIcon className="w-4.5 h-4.5" />
          </button>
        </div>

        <div className="p-4 sm:p-5 overflow-y-auto flex-1">
          {loadError ? <div className="text-[13px] text-danger font-semibold">{loadError}</div> : null}
          {!preview && !loadError ? <div className="text-[13px] text-muted py-6 text-center">در حال بررسی رکوردهای کاربر…</div> : null}

          {preview && step === 1 ? (
            <div className="flex flex-col gap-3">
              {preview.blockingIssues.length > 0 ? (
                <div role="alert" className="bg-danger-soft text-danger rounded-xl p-3 text-[13px] font-semibold flex flex-col gap-1">
                  {preview.blockingIssues.map((b) => (
                    <div key={b.code}>{b.message}</div>
                  ))}
                </div>
              ) : null}
              {preview.warnings.map((w) => (
                <div key={w.code} className="bg-warning-soft text-warning rounded-xl p-3 text-[12.5px] leading-relaxed">
                  {w.message}
                </div>
              ))}
              <div className="text-[13px] text-ink-soft">
                {hasRecords ? (
                  <>
                    <b>{toPersianDigits(preview.totalOwned)}</b> رکورد در دست «{user.name}» است. تاریخچه و نام نویسنده‌ی رکوردهای گذشته هرگز تغییر نمی‌کند؛ فقط مسئولیت کارهای جاری منتقل می‌شود.
                  </>
                ) : (
                  <>«{user.name}» رکورد جاری‌ای برای انتقال ندارد.</>
                )}
              </div>
              {hasRecords ? (
                <div className="flex flex-col gap-2">
                  {preview.modules.map((m) => (
                    <details key={m.moduleCode} className="border border-border rounded-xl">
                      <summary className="flex items-center justify-between gap-2 px-3 min-h-11 cursor-pointer list-none">
                        <span className="text-[13.5px] font-bold">
                          {m.label}
                          {!m.installed ? <Badge tone="neutral" className="ms-2">ماژول غیرفعال</Badge> : null}
                        </span>
                        <Badge tone="primary">{toPersianDigits(m.total)} رکورد</Badge>
                      </summary>
                      <div className="px-3 pb-3 flex flex-col gap-2">
                        {m.entries.map((e) => (
                          <div key={e.key} className="flex items-start justify-between gap-3 text-[12.5px]">
                            <div>
                              <div className="font-semibold">{e.label}</div>
                              <div className="text-[11.5px] text-muted leading-relaxed">{e.scopeNote}</div>
                            </div>
                            <span className="font-bold shrink-0">{toPersianDigits(e.count)}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {preview && step === 2 ? (
            <div className="flex flex-col gap-4">
              {hasRecords ? (
                <>
                  <UserCombobox label="رکوردها به چه کسی منتقل شود؟" users={candidates} value={target} onChange={setTarget} suggestedIds={suggestedIds} suggestionLabels={suggestionLabels} />
                  {preview.suggestedTargets.length > 0 ? <p className="text-[12px] text-muted">پیشنهاد اول، مدیر مستقیم کاربر در پرونده‌ی پرسنلی است (در صورت ثبت).</p> : null}
                  <details className="border border-border rounded-xl">
                    <summary className="px-3 min-h-11 flex items-center cursor-pointer text-[13.5px] font-bold list-none">مقصد متفاوت برای ماژول‌های خاص (اختیاری)</summary>
                    <div className="px-3 pb-3 flex flex-col gap-3">
                      {preview.modules.map((m) => (
                        <div key={m.moduleCode}>
                          <label htmlFor={`ov-${m.moduleCode}`} className="block text-[12.5px] font-semibold mb-1">
                            {m.label} ({toPersianDigits(m.total)} رکورد)
                          </label>
                          <select
                            id={`ov-${m.moduleCode}`}
                            value={overrides[m.moduleCode] ?? ""}
                            onChange={(e) => setOverrides((o) => ({ ...o, [m.moduleCode]: e.target.value }))}
                            className={inputCls}
                          >
                            <option value="">همان مقصد اصلی</option>
                            {candidates.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </details>
                </>
              ) : (
                <p className="text-[13px] text-ink-soft">رکوردی برای انتقال وجود ندارد؛ می‌توانید مستقیم به مرحله‌ی بعد بروید.</p>
              )}
            </div>
          ) : null}

          {preview && step === 3 ? (
            <div className="flex flex-col gap-4">
              {dryLoading ? <div className="text-[13px] text-muted py-4 text-center">در حال محاسبه‌ی دقیق…</div> : null}
              {dryError ? (
                <div role="alert" className="text-[13px] text-danger font-semibold">
                  {dryError}
                </div>
              ) : null}

              {dry && !dryLoading ? (
                <>
                  <div className="text-[13px] text-ink-soft leading-relaxed">
                    {hasRecords ? (
                      <>
                        از «<b>{user.name}</b>» به «<b>{dry.target?.name ?? nameOf(target)}</b>»{Object.keys(overrides).some((k) => overrides[k]) ? " (و مقصدهای اختصاصی ماژول‌ها)" : ""}:
                      </>
                    ) : (
                      <>رکوردی برای انتقال نیست.</>
                    )}
                  </div>
                  {dry.modules.length > 0 ? (
                    <div className="border border-border rounded-xl overflow-hidden">
                      <table className="w-full text-[13px]">
                        <thead className="bg-slate-50 text-muted text-[11.5px]">
                          <tr>
                            <th className="text-start px-3 py-2 font-semibold">ماژول</th>
                            <th className="text-start px-3 py-2 font-semibold">منتقل</th>
                            <th className="text-start px-3 py-2 font-semibold">ادغام</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dry.modules.map((m) => (
                            <tr key={m.moduleCode} className="border-t border-border">
                              <td className="px-3 py-2 font-semibold">{m.label}</td>
                              <td className="px-3 py-2">{toPersianDigits(m.moved + m.unassigned)}</td>
                              <td className="px-3 py-2">{toPersianDigits(m.merged)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                  {dry.warnings.map((w, i) => (
                    <div key={`${w.code}-${i}`} className="bg-warning-soft text-warning rounded-xl p-3 text-[12.5px] leading-relaxed">
                      {w.message}
                    </div>
                  ))}
                  {needsAccept ? (
                    <label className="flex items-start gap-2.5 min-h-11 cursor-pointer text-[13px] font-semibold">
                      <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-1 w-5 h-5" />
                      <span>می‌دانم مقصد به برخی از این بخش‌ها دسترسی مشاهده ندارد؛ با همین انتخاب ادامه بده.</span>
                    </label>
                  ) : null}

                  {!transferOnly ? (
                    <fieldset className="flex flex-col gap-2">
                      <legend className="text-[13px] font-extrabold mb-1">وضعیت حساب کاربر</legend>
                      <label className="flex items-start gap-2.5 border border-border rounded-xl p-3 cursor-pointer min-h-11">
                        <input type="radio" name="outcome" checked={outcome === "deactivate"} onChange={() => setOutcome("deactivate")} className="mt-1 w-5 h-5" />
                        <span>
                          <span className="block text-[13.5px] font-bold">
                            غیرفعال‌سازی <Badge tone="success">پیشنهادی</Badge>
                          </span>
                          <span className="block text-[12px] text-muted leading-relaxed mt-0.5">ورود او بسته و نشست‌هایش باطل می‌شود. نام او در همه‌ی تاریخچه‌ها (فاکتور، لاگ، امضا) باقی می‌ماند و در صورت نیاز قابل بازگشت است. صندلی لایسنس آزاد نمی‌شود.</span>
                        </span>
                      </label>
                      <label className={`flex items-start gap-2.5 border border-border rounded-xl p-3 min-h-11 ${canDeleteFully ? "cursor-pointer" : "opacity-60"}`}>
                        <input type="radio" name="outcome" disabled={!canDeleteFully} checked={outcome === "delete"} onChange={() => setOutcome("delete")} className="mt-1 w-5 h-5" />
                        <span>
                          <span className="block text-[13.5px] font-bold">حذف کامل</span>
                          <span className="block text-[12px] text-muted leading-relaxed mt-0.5">
                            حساب، اعلان‌ها و دسترسی‌های او پاک و صندلی لایسنس آزاد می‌شود. تاریخچه‌ی رکوردها حفظ می‌شود اما نام او در آن‌ها «کاربر حذف‌شده» نمایش داده می‌شود. غیرقابل بازگشت.
                            {!canDeleteFully ? " فقط مدیر کل می‌تواند حذف کامل کند." : ""}
                          </span>
                        </span>
                      </label>
                    </fieldset>
                  ) : (
                    <p className="text-[12.5px] text-ink-soft bg-primary-soft rounded-xl p-3 leading-relaxed">فقط رکوردها منتقل می‌شوند؛ حساب، نقش و دسترسی‌های «{user.name}» دست‌نخورده می‌ماند (مناسب تغییر نقش یا مرخصی).</p>
                  )}

                  {dry.cleanup.length > 0 ? (
                    <div className="text-[12px] text-muted leading-relaxed">
                      پاک‌سازی داده‌ی شخصی: {dry.cleanup.map((c) => `${c.label} (${toPersianDigits(c.count)})`).join("، ")}
                    </div>
                  ) : null}

                  <label className="flex items-center gap-2.5 min-h-11 cursor-pointer text-[13px]">
                    <input type="checkbox" checked={notifyManager} onChange={(e) => setNotifyManager(e.target.checked)} className="w-5 h-5" />
                    <span>مدیر مستقیم کاربر هم مطلع شود</span>
                  </label>
                  <div>
                    <label htmlFor="offboard-reason" className="block text-[12.5px] font-semibold mb-1">
                      دلیل (اختیاری، در گزارش ثبت می‌شود)
                    </label>
                    <input id="offboard-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} className={inputCls} />
                  </div>
                  {!transferOnly ? (
                    <div>
                      <label htmlFor="offboard-confirm" className="block text-[12.5px] font-semibold mb-1">
                        برای تأیید، نام کاربر را تایپ کنید: <b>{user.name}</b>
                      </label>
                      <input id="offboard-confirm" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" className={inputCls} />
                    </div>
                  ) : null}
                  <p className="text-[11.5px] text-muted leading-relaxed">بازگردانی خودکار (undo) وجود ندارد؛ پس از اجرا، فایل CSV شناسه‌ی رکوردهای جابه‌جاشده را برای بازگردانی دستی دانلود کنید.</p>
                </>
              ) : null}
              {runError ? (
                <div role="alert" className="text-[13px] text-danger font-semibold">
                  {runError}
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 4 && result ? (
            <div className="flex flex-col gap-3" aria-live="polite">
              <div className="bg-success-soft text-success rounded-xl p-3 text-[13.5px] font-bold">
                {result.userOutcome === "deactivated" ? "کاربر غیرفعال شد و رکوردهای او منتقل شد." : null}
                {result.userOutcome === "anonymised" ? "کاربر حذف شد (نام او در تاریخچه «کاربر حذف‌شده» نمایش داده می‌شود) و رکوردهایش منتقل شد." : null}
                {result.userOutcome === "deleted" ? "کاربر کاملاً حذف شد و رکوردهایش منتقل شد." : null}
                {result.userOutcome === "unchanged" ? "رکوردها منتقل شد؛ حساب کاربر دست‌نخورده ماند." : null}
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="border border-border rounded-xl p-2.5">
                  <div className="text-lg font-extrabold">{toPersianDigits(result.totals.moved)}</div>
                  <div className="text-[11.5px] text-muted">منتقل‌شده</div>
                </div>
                <div className="border border-border rounded-xl p-2.5">
                  <div className="text-lg font-extrabold">{toPersianDigits(result.totals.merged)}</div>
                  <div className="text-[11.5px] text-muted">ادغام‌شده</div>
                </div>
                <div className="border border-border rounded-xl p-2.5">
                  <div className="text-lg font-extrabold">{toPersianDigits(result.totals.unassigned)}</div>
                  <div className="text-[11.5px] text-muted">بازگشته به مدیران</div>
                </div>
              </div>
              {result.modules.length > 0 ? (
                <ul className="text-[13px] flex flex-col gap-1.5">
                  {result.modules.map((m) => (
                    <li key={m.moduleCode} className="flex items-center justify-between border-b border-border pb-1.5">
                      <span className="font-semibold">{m.label}</span>
                      <span>{toPersianDigits(m.moved + m.unassigned)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {result.freesLicenseSeat ? <p className="text-[12.5px] text-ink-soft">صندلی لایسنس این کاربر آزاد شد.</p> : null}
              {result.truncated ? <p className="text-[12px] text-warning">تعداد رکوردها از سقف ذخیره‌ی شناسه فراتر رفت؛ فایل CSV بخشی از شناسه‌هاست (شمارش‌ها کامل است).</p> : null}
              <button type="button" onClick={downloadCsv} disabled={!result.runId} className={`${btnGhost} text-primary`}>
                دانلود گزارش CSV (برای بازگردانی دستی)
              </button>
              {csvError ? <div className="text-[12.5px] text-danger">{csvError}</div> : null}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3 border-t border-border shrink-0">
          {step === 4 ? (
            <button type="button" onClick={onDone} className={`${btnPrimary} w-full sm:w-auto sm:ms-auto`}>
              بستن
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={running || step === 1}
                onClick={() => setStep((s) => (s > 1 ? ((s - 1) as Step) : s))}
                className={btnGhost}
              >
                قبلی
              </button>
              {step === 1 ? (
                <button type="button" disabled={!preview || blocked} onClick={() => setStep(2)} className={btnPrimary}>
                  ادامه
                </button>
              ) : null}
              {step === 2 ? (
                <button type="button" disabled={targetRequired && !target} onClick={goReview} className={btnPrimary}>
                  بازبینی
                </button>
              ) : null}
              {step === 3 ? (
                <button type="button" disabled={!canRun} onClick={run} className={`${btnPrimary} ${!transferOnly ? "!bg-danger" : ""}`}>
                  {running ? "در حال اجرا…" : transferOnly ? "انتقال رکوردها" : outcome === "delete" ? "حذف کاربر و انتقال" : "غیرفعال‌سازی و انتقال"}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
