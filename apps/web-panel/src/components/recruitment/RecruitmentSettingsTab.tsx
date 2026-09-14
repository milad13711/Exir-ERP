"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import {
  fetchRecruitmentGeneralSettings,
  updateRecruitmentGeneralSettings,
  fetchRecruitmentSmsSettings,
  updateRecruitmentSmsSettings,
  fetchRecruitmentCompanySeal,
  updateRecruitmentCompanySeal,
  type RecruitmentGeneralSettings,
  type RecruitmentSmsSettings,
  type RecruitmentCompanySeal,
} from "@/lib/api";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function RecruitmentSettingsTab() {
  const [subTab, setSubTab] = useState<"general" | "sms" | "seal">("general");
  const [general, setGeneral] = useState<RecruitmentGeneralSettings | null>(null);
  const [sms, setSms] = useState<RecruitmentSmsSettings | null>(null);
  const [seal, setSeal] = useState<RecruitmentCompanySeal | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchRecruitmentGeneralSettings().then(setGeneral);
    fetchRecruitmentSmsSettings().then(setSms);
    fetchRecruitmentCompanySeal().then(setSeal);
  }, []);

  function flashSaved() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function saveGeneral() {
    if (!general) return;
    setGeneral(await updateRecruitmentGeneralSettings(general));
    flashSaved();
  }

  async function saveSms() {
    if (!sms) return;
    setSms(await updateRecruitmentSmsSettings(sms));
    flashSaved();
  }

  async function saveSeal() {
    if (!seal) return;
    setSeal(await updateRecruitmentCompanySeal(seal));
    flashSaved();
  }

  return (
    <div className="max-w-[560px]">
      <div className="flex items-center gap-2 mb-4">
        {[
          { key: "general" as const, label: "عمومی" },
          { key: "sms" as const, label: "پیامک" },
          { key: "seal" as const, label: "مهر و امضا" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={clsx("text-[12.5px] font-semibold px-3.5 py-2 rounded-[10px]", subTab === t.key ? "bg-primary text-white" : "bg-slate-100 text-ink-soft")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === "general" && general && (
        <Card className="p-5 flex flex-col gap-3.5">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-ink-soft">مدت پیش‌فرض هر مصاحبه (دقیقه)</span>
            <input
              type="number"
              min={5}
              value={general.defaultInterviewMinutes}
              onChange={(e) => setGeneral({ ...general, defaultInterviewMinutes: Number(e.target.value) })}
              className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-ink-soft">بافر زمانی بین دو مصاحبه (دقیقه)</span>
            <input
              type="number"
              min={0}
              value={general.bufferMinutesBetweenInterviews}
              onChange={(e) => setGeneral({ ...general, bufferMinutesBetweenInterviews: Number(e.target.value) })}
              className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
            />
          </label>
          <button onClick={saveGeneral} className="self-start text-[12.5px] font-bold px-5 py-2.5 rounded-xl bg-primary text-white cursor-pointer">
            {saved ? "ذخیره شد ✓" : "ذخیره"}
          </button>
        </Card>
      )}

      {subTab === "sms" && sms && (
        <Card className="p-5 flex flex-col gap-3.5">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={sms.enabled} onChange={(e) => setSms({ ...sms, enabled: e.target.checked })} className="w-4 h-4 cursor-pointer" />
            <span className="text-[13px] font-bold">ارسال پیامک برای این ماژول فعال باشد</span>
          </label>

          {([
            ["دعوت به مصاحبه", "interviewInvitationTemplate"],
            ["تأیید کارشناس", "specialistApprovedTemplate"],
            ["رد کارشناس", "specialistRejectedTemplate"],
            ["تأیید نهایی مدیریت", "managementApprovedTemplate"],
            ["رد نهایی مدیریت", "managementRejectedTemplate"],
          ] as const).map(([label, key]) => (
            <div key={key} className="border border-border rounded-xl p-3">
              <div className="text-[12.5px] font-bold mb-2">{label}</div>
              <input
                value={sms[key]}
                onChange={(e) => setSms({ ...sms, [key]: e.target.value })}
                className="w-full text-[12.5px] outline-none bg-surface border border-border rounded-lg px-3 py-2 focus:border-primary"
              />
            </div>
          ))}

          <button onClick={saveSms} className="self-start text-[12.5px] font-bold px-5 py-2.5 rounded-xl bg-primary text-white cursor-pointer">
            {saved ? "ذخیره شد ✓" : "ذخیره"}
          </button>
        </Card>
      )}

      {subTab === "seal" && seal && (
        <Card className="p-5 flex flex-col gap-3.5">
          <div className="text-[12px] text-muted leading-relaxed">
            این مهر و امضا روی PDF شرایط همکاری، پس از تأیید نهایی مدیر، درج می‌شود.
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-ink-soft">تصویر مهر شرکت</span>
            {seal.stampImage && <img src={seal.stampImage} alt="مهر" className="h-16 w-auto" />}
            <input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) setSeal({ ...seal, stampImage: await fileToDataUrl(file) });
              }}
              className="text-[12.5px]"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-ink-soft">تصویر امضای مدیر</span>
            {seal.signatureImage && <img src={seal.signatureImage} alt="امضا" className="h-16 w-auto" />}
            <input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) setSeal({ ...seal, signatureImage: await fileToDataUrl(file) });
              }}
              className="text-[12.5px]"
            />
          </label>
          <button onClick={saveSeal} className="self-start text-[12.5px] font-bold px-5 py-2.5 rounded-xl bg-primary text-white cursor-pointer">
            {saved ? "ذخیره شد ✓" : "ذخیره"}
          </button>
        </Card>
      )}
    </div>
  );
}
