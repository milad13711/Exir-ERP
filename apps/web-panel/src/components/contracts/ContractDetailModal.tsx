import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { SignaturePad } from "@/components/ui/SignaturePad";
import { AttachmentsSection } from "@/components/shared/AttachmentsSection";
import { TasksSection } from "@/components/shared/TasksSection";
import { SendIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { formatToman, formatJalaliDate, formatJalaliDateTime } from "@/lib/persian";
import { useWorkspace } from "@/lib/workspace-context";
import {
  signContract,
  terminateContract,
  renewContract,
  fetchContractEditRequests,
  resolveContractEditRequest,
  fetchContractAmendments,
  createContractAmendment,
  signContractAmendmentAsCompany,
  fetchContractWitnesses,
  addContractWitness,
  removeContractWitness,
  fetchCompanySignature,
  openContractPdf,
  type Contract,
  type ContractStatus,
  type ContractLegalCategory,
  type ContractEditRequest,
  type ContractAmendment,
  type ContractWitness,
} from "@/lib/api";

const STATUS_LABELS: Record<ContractStatus, string> = {
  DRAFT: "پیش‌نویس",
  ACTIVE: "فعال",
  EXPIRED: "منقضی‌شده",
  TERMINATED: "فسخ‌شده",
};
const STATUS_TONES: Record<ContractStatus, "primary" | "success" | "neutral" | "danger"> = {
  DRAFT: "neutral",
  ACTIVE: "success",
  EXPIRED: "danger",
  TERMINATED: "danger",
};
const LEGAL_CATEGORY_LABELS: Record<ContractLegalCategory, string> = {
  NOTARIZED: "دفترخانه اسناد رسمی",
  LAWYER_SUPERVISED: "تحت نظارت وکیل",
  GENERAL: "عمومی",
};

function partyDisplayName(contract: Contract): string {
  return contract.employee?.fullName ?? contract.contact?.name ?? "—";
}

export function ContractDetailModal({
  contract,
  onClose,
  onChanged,
}: {
  contract: Contract;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [terminateOpen, setTerminateOpen] = useState(false);
  const [terminateReason, setTerminateReason] = useState("");
  const [renewOpen, setRenewOpen] = useState(false);
  const [newEndDate, setNewEndDate] = useState("");
  const [signing, setSigning] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const [editRequests, setEditRequests] = useState<ContractEditRequest[]>(contract.editRequests ?? []);
  const [amendments, setAmendments] = useState<ContractAmendment[]>(contract.amendments ?? []);
  const [amendmentText, setAmendmentText] = useState("");
  const [addingAmendment, setAddingAmendment] = useState(false);
  const [witnesses, setWitnesses] = useState<ContractWitness[]>(contract.witnesses ?? []);
  const [witnessName, setWitnessName] = useState("");
  const [witnessPhone, setWitnessPhone] = useState("");
  const [addingWitness, setAddingWitness] = useState(false);
  const [savedSignature, setSavedSignature] = useState<{ signatureImage?: string; stampImage?: string } | null>(null);
  const { me } = useWorkspace();

  useEffect(() => {
    fetchContractEditRequests(contract.id).then(setEditRequests).catch(() => {});
    fetchContractAmendments(contract.id).then(setAmendments).catch(() => {});
    fetchContractWitnesses(contract.id).then(setWitnesses).catch(() => {});
    fetchCompanySignature().then(setSavedSignature).catch(() => setSavedSignature({}));
  }, [contract.id]);

  const expiryDays = Math.ceil((new Date(contract.endDate).getTime() - Date.now()) / 86_400_000);
  const signatureCount = (contract.partyASignedAt ? 1 : 0) + (contract.partyBSignedAt ? 1 : 0);

  async function copyPublicLink() {
    if (!me) return;
    const url = `${window.location.origin}/sign/${me.tenant.publicKey ?? me.tenant.slug}/${contract.publicToken}`;
    await navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  async function handleSign(signatureDataUrl: string) {
    setBusy(true);
    setError(null);
    try {
      await signContract(contract.id, { signatureDataUrl, signerName: me?.user.name ?? "نماینده شرکت" });
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "امضای قرارداد ناموفق بود");
      setSigning(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleTerminate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await terminateContract(contract.id, terminateReason.trim() || undefined);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فسخ قرارداد ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function handleRenew(e: React.FormEvent) {
    e.preventDefault();
    if (!newEndDate) return;
    setBusy(true);
    setError(null);
    try {
      await renewContract(contract.id, newEndDate);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تمدید قرارداد ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function handleResolveEditRequest(id: string) {
    try {
      const updated = await resolveContractEditRequest(id);
      setEditRequests((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch {
      // فقط برای این آیتم ناموفق می‌ماند — بقیه‌ی صفحه دست‌نخورده باقی می‌ماند
    }
  }

  async function handleAddAmendment(e: React.FormEvent) {
    e.preventDefault();
    if (!amendmentText.trim()) return;
    setAddingAmendment(true);
    try {
      const created = await createContractAmendment(contract.id, amendmentText.trim());
      setAmendments((prev) => [created, ...prev]);
      setAmendmentText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ثبت الحاقیه ناموفق بود");
    } finally {
      setAddingAmendment(false);
    }
  }

  async function handleSignAmendment(amendmentId: string, signatureDataUrl: string) {
    try {
      const updated = await signContractAmendmentAsCompany(amendmentId, { signatureDataUrl, signerName: me?.user.name ?? "نماینده شرکت" });
      setAmendments((prev) => prev.map((a) => (a.id === amendmentId ? updated : a)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "امضای الحاقیه ناموفق بود");
    }
  }

  async function handleAddWitness(e: React.FormEvent) {
    e.preventDefault();
    if (!witnessName.trim() || !witnessPhone.trim()) return;
    setAddingWitness(true);
    try {
      const created = await addContractWitness(contract.id, { name: witnessName.trim(), phone: witnessPhone.trim() });
      setWitnesses((prev) => [created, ...prev]);
      setWitnessName("");
      setWitnessPhone("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ثبت شاهد ناموفق بود");
    } finally {
      setAddingWitness(false);
    }
  }

  async function handleRemoveWitness(id: string) {
    try {
      await removeContractWitness(id);
      setWitnesses((prev) => prev.filter((w) => w.id !== id));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "حذف شاهد ناموفق بود");
    }
  }

  const unresolvedEditRequests = editRequests.filter((r) => !r.resolved);

  return (
    <Modal title={`قرارداد شماره ${contract.contractNo}`} onClose={onClose} width="max-w-[600px]">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[15px] font-bold">{contract.title}</div>
            <div className="text-[12.5px] text-muted mt-1">
              {partyDisplayName(contract)}
              {contract.partyMode === "THIRD_PARTY" && (
                <> ⟷ {contract.secondPartyContact?.name ?? contract.secondPartyName ?? "—"}</>
              )}
              {contract.contact?.company ? ` — ${contract.contact.company}` : ""}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Badge tone={STATUS_TONES[contract.status]}>{STATUS_LABELS[contract.status]}</Badge>
            <Badge tone="neutral">{LEGAL_CATEGORY_LABELS[contract.legalCategory]}</Badge>
            {contract.category && <Badge tone="neutral">{contract.category}</Badge>}
            {contract.status === "ACTIVE" && expiryDays <= 30 && (
              <Badge tone={expiryDays < 0 ? "danger" : "warning"}>
                {expiryDays < 0 ? `${Math.abs(expiryDays)} روز عقب‌افتاده` : `${expiryDays} روز تا انقضا`}
              </Badge>
            )}
            {contract.partyMode !== "THIRD_PARTY" || signatureCount > 0 ? (
              <Badge tone={signatureCount === 2 ? "success" : signatureCount === 1 ? "warning" : "neutral"}>
                امضا {signatureCount}/۲
              </Badge>
            ) : null}
          </div>
        </div>

        <button
          onClick={() => openContractPdf(contract.id)}
          className="self-start text-[12px] font-bold text-primary bg-primary-soft px-3 py-1.5 rounded-lg cursor-pointer"
        >
          دریافت PDF / چاپ
        </button>

        {contract.isLocked && (
          <div className="text-[11.5px] text-success bg-success-soft rounded-xl px-3 py-2 flex items-center gap-1.5">
            🔒 این قرارداد با امضای دیجیتال هر دو طرف قفل شده و غیرقابل ویرایش است.
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-[11px] text-muted mb-1">ارزش قرارداد</div>
            <div className="text-[13.5px] font-extrabold">{formatToman(contract.value)}</div>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-[11px] text-muted mb-1">نوع</div>
            <div className="text-[13.5px] font-bold">{contract.type === "SALES" ? "فروش" : contract.type === "PURCHASE" ? "خرید" : "—"}</div>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-[11px] text-muted mb-1">تاریخ شروع</div>
            <div className="text-[13px] font-bold">{formatJalaliDate(contract.startDate)}</div>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-[11px] text-muted mb-1">تاریخ پایان</div>
            <div className="text-[13px] font-bold">{formatJalaliDate(contract.endDate)}</div>
          </div>
        </div>

        {contract.terms && (
          <div>
            <div className="text-[12px] font-semibold text-ink-soft mb-1.5">شرح بندها و شرایط</div>
            <div className="text-[12.5px] text-ink-soft leading-relaxed bg-slate-50 rounded-xl p-3 whitespace-pre-wrap">
              {contract.terms}
            </div>
          </div>
        )}

        {contract.status === "TERMINATED" && contract.terminationReason && (
          <div className="text-[12.5px] text-danger bg-danger-soft rounded-xl p-3">
            دلیل فسخ: {contract.terminationReason}
          </div>
        )}

        {!contract.isLocked && (
          <button
            onClick={copyPublicLink}
            className="flex items-center justify-center gap-1.5 bg-surface border border-border text-ink-soft text-[12.5px] font-bold px-3.5 py-2.5 rounded-xl cursor-pointer"
          >
            <SendIcon className="w-4 h-4" />
            {linkCopied ? "لینک کپی شد" : "لینک عمومی امضای دیجیتال"}
          </button>
        )}

        {(contract.partyASignedAt || contract.partyBSignedAt) && (
          <div className="grid grid-cols-2 gap-3">
            <div className={`rounded-xl p-3 ${contract.partyASignedAt ? "bg-success-soft" : "bg-slate-50"}`}>
              <div className="text-[11px] text-muted mb-1">امضای طرف اول</div>
              <div className="text-[12.5px] font-bold">
                {contract.partyASignedAt ? `${contract.partyASignerName} — ${formatJalaliDateTime(contract.partyASignedAt)}` : "هنوز امضا نشده"}
              </div>
            </div>
            <div className={`rounded-xl p-3 ${contract.partyBSignedAt ? "bg-success-soft" : "bg-slate-50"}`}>
              <div className="text-[11px] text-muted mb-1">{contract.partyMode === "THIRD_PARTY" ? "امضای طرف دوم" : "امضای شرکت"}</div>
              <div className="text-[12.5px] font-bold">
                {contract.partyBSignedAt ? `${contract.partyBSignerName} — ${formatJalaliDateTime(contract.partyBSignedAt)}` : "هنوز امضا نشده"}
              </div>
            </div>
          </div>
        )}

        {unresolvedEditRequests.length > 0 && (
          <div>
            <div className="text-[12px] font-semibold text-ink-soft mb-1.5">درخواست‌های ویرایش طرفین</div>
            <div className="flex flex-col gap-2">
              {unresolvedEditRequests.map((r) => (
                <div key={r.id} className="flex items-start gap-2 bg-warning-soft rounded-xl p-3">
                  <div className="flex-1">
                    <div className="text-[11px] text-muted mb-0.5">{r.side === "PARTY_A" ? "طرف اول" : "طرف دوم"}</div>
                    <div className="text-[12.5px]">{r.text}</div>
                  </div>
                  <button onClick={() => handleResolveEditRequest(r.id)} className="text-[11px] font-bold text-primary shrink-0 cursor-pointer">
                    بررسی شد
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}

        {signing ? (
          <div className="bg-primary-soft rounded-xl p-3.5">
            <div className="text-[12px] font-semibold text-primary mb-2">امضای طرف شرکت</div>
            {savedSignature?.signatureImage && (
              <button
                type="button"
                onClick={() => handleSign(savedSignature.signatureImage!)}
                disabled={busy}
                className="w-full flex items-center justify-center gap-2 py-2.5 mb-2.5 rounded-xl bg-white border border-primary text-primary text-[12.5px] font-bold cursor-pointer disabled:opacity-50"
              >
                <img src={savedSignature.signatureImage} alt="" className="h-6" />
                استفاده از امضای ذخیره‌شده
              </button>
            )}
            <SignaturePad onDone={handleSign} onCancel={() => setSigning(false)} />
          </div>
        ) : terminateOpen ? (
          <form onSubmit={handleTerminate} className="flex flex-col gap-2.5 bg-danger-soft rounded-xl p-3.5">
            <label className="text-[12px] font-semibold text-danger">دلیل فسخ (اختیاری)</label>
            <input
              value={terminateReason}
              onChange={(e) => setTerminateReason(e.target.value)}
              className="text-[13px] outline-none bg-white border border-border rounded-lg px-3 py-2"
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={busy}
                className="text-[12px] font-bold text-white bg-danger px-3.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
              >
                تأیید فسخ
              </button>
              <button type="button" onClick={() => setTerminateOpen(false)} className="text-[12px] font-bold text-ink-soft">
                انصراف
              </button>
            </div>
          </form>
        ) : renewOpen ? (
          <form onSubmit={handleRenew} className="flex flex-col gap-2.5 bg-primary-soft rounded-xl p-3.5">
            <label className="text-[12px] font-semibold text-primary">تاریخ پایان جدید</label>
            <JalaliDateInput
              value={newEndDate}
              onChange={setNewEndDate}
              className="text-[13px] outline-none bg-white border border-border rounded-lg px-3 py-2"
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={busy || !newEndDate}
                className="text-[12px] font-bold text-white bg-primary px-3.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
              >
                تأیید تمدید
              </button>
              <button type="button" onClick={() => setRenewOpen(false)} className="text-[12px] font-bold text-ink-soft">
                انصراف
              </button>
            </div>
          </form>
        ) : (
          <div className="flex items-center gap-2">
            {contract.status === "DRAFT" && contract.partyMode !== "THIRD_PARTY" && !contract.partyBSignedAt && (
              <button
                onClick={() => setSigning(true)}
                disabled={busy}
                className="flex-1 py-2.5 rounded-xl bg-primary text-white text-[12.5px] font-bold cursor-pointer disabled:opacity-50"
              >
                امضای شرکت
              </button>
            )}
            {(contract.status === "ACTIVE" || contract.status === "EXPIRED") && (
              <button
                onClick={() => setRenewOpen(true)}
                className="flex-1 py-2.5 rounded-xl border border-border text-ink-soft text-[12.5px] font-bold cursor-pointer"
              >
                تمدید
              </button>
            )}
            {contract.status === "ACTIVE" && (
              <button
                onClick={() => setTerminateOpen(true)}
                className="flex-1 py-2.5 rounded-xl border border-danger/30 text-danger text-[12.5px] font-bold cursor-pointer"
              >
                فسخ قرارداد
              </button>
            )}
          </div>
        )}

        {contract.isLocked && (
          <div>
            <div className="text-[12px] font-semibold text-ink-soft mb-1.5">الحاقیه‌ها</div>
            <form onSubmit={handleAddAmendment} className="flex items-center gap-2 mb-2.5">
              <input
                value={amendmentText}
                onChange={(e) => setAmendmentText(e.target.value)}
                placeholder="متن الحاقیه/اصلاحیه جدید..."
                className="flex-1 text-[12.5px] outline-none bg-slate-50 border border-border rounded-lg px-3 py-2"
              />
              <button
                type="submit"
                disabled={addingAmendment || !amendmentText.trim()}
                className="text-[12px] font-bold text-white bg-primary px-3.5 py-2 rounded-lg cursor-pointer disabled:opacity-50 shrink-0"
              >
                افزودن
              </button>
            </form>
            <div className="flex flex-col gap-2">
              {amendments.map((a) => (
                <div key={a.id} className="bg-slate-50 rounded-xl p-3">
                  <div className="text-[12.5px] mb-2">{a.text}</div>
                  {a.isLocked ? (
                    <div className="text-[11px] text-success font-semibold">🔒 امضا و قفل‌شده — {formatJalaliDateTime(a.partyBSignedAt!)}</div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] text-muted">
                        {a.partyASignedAt ? "طرف اول امضا کرده" : "منتظر امضای طرف اول"} ·{" "}
                        {a.partyBSignedAt ? "شرکت امضا کرده" : "منتظر امضای شرکت"}
                      </div>
                      {!a.partyBSignedAt && contract.partyMode !== "THIRD_PARTY" && (
                        <AmendmentSignButton amendmentId={a.id} onSign={handleSignAmendment} />
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="text-[12px] font-semibold text-ink-soft mb-1.5">شاهدها</div>
          {!contract.isLocked && (
            <form onSubmit={handleAddWitness} className="flex items-center gap-2 mb-2.5">
              <input
                value={witnessName}
                onChange={(e) => setWitnessName(e.target.value)}
                placeholder="نام شاهد"
                className="flex-1 text-[12.5px] outline-none bg-slate-50 border border-border rounded-lg px-3 py-2"
              />
              <input
                value={witnessPhone}
                onChange={(e) => setWitnessPhone(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="09xxxxxxxxx"
                dir="ltr"
                className="w-[140px] text-[12.5px] outline-none bg-slate-50 border border-border rounded-lg px-3 py-2"
              />
              <button
                type="submit"
                disabled={addingWitness || !witnessName.trim() || !witnessPhone.trim()}
                className="text-[12px] font-bold text-white bg-primary px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50 shrink-0 flex items-center gap-1"
              >
                <PlusIcon className="w-3.5 h-3.5" />
                افزودن
              </button>
            </form>
          )}
          {witnesses.length > 0 && (
            <div className="flex flex-col gap-2">
              {witnesses.map((w) => (
                <div key={w.id} className="flex items-center justify-between gap-2 bg-slate-50 rounded-xl p-3">
                  <div>
                    <div className="text-[12.5px] font-bold">{w.name}</div>
                    <div className="text-[11px] text-muted mt-0.5" dir="ltr">
                      {w.phone}
                    </div>
                  </div>
                  {w.signedAt ? (
                    <Badge tone="success">امضا شد — {formatJalaliDateTime(w.signedAt)}</Badge>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Badge tone="neutral">در انتظار امضا</Badge>
                      {!contract.isLocked && (
                        <button onClick={() => handleRemoveWitness(w.id)} className="text-muted hover:text-danger cursor-pointer">
                          <TrashIcon className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <TasksSection relatedModule="contract" relatedEntityId={contract.id} />
        <AttachmentsSection entityType="Contract" entityId={contract.id} />
      </div>
    </Modal>
  );
}

function AmendmentSignButton({ amendmentId, onSign }: { amendmentId: string; onSign: (id: string, dataUrl: string) => void }) {
  const [open, setOpen] = useState(false);
  if (open) {
    return (
      <div className="w-full">
        <SignaturePad
          onDone={(dataUrl) => {
            onSign(amendmentId, dataUrl);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      </div>
    );
  }
  return (
    <button onClick={() => setOpen(true)} className="text-[11px] font-bold text-primary shrink-0 cursor-pointer">
      امضای شرکت
    </button>
  );
}
