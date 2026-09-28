"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { SearchIcon, StarIcon, PlusIcon } from "@/components/icons";
import { formatJalaliDate, toPersianDigits } from "@/lib/persian";
import { useWorkspace } from "@/lib/workspace-context";
import {
  fetchCertificates,
  deleteCertificate,
  fetchCertificateImageObjectUrl,
  fetchCertificatePdfObjectUrl,
  fetchCertificateTemplateSettings,
  type Certificate,
  type CertificateTemplateSettings,
} from "@/lib/api";
import { NewCertificateModal } from "@/components/certificates/NewCertificateModal";
import { CertificateTemplateSettingsModal } from "@/components/certificates/CertificateTemplateSettingsModal";

function download(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

export default function CertificatesPage() {
  const { me } = useWorkspace();
  const isManager = me?.user.membershipRole === "OWNER" || me?.user.membershipRole === "ADMIN";

  const [certificates, setCertificates] = useState<Certificate[] | null>(null);
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateSettings, setTemplateSettings] = useState<CertificateTemplateSettings | null>(null);

  function reload() {
    fetchCertificates({ search: search || undefined })
      .then(setCertificates)
      .catch(() => setCertificates([]));
  }

  useEffect(() => {
    const t = setTimeout(reload, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function openTemplateSettings() {
    const settings = await fetchCertificateTemplateSettings();
    setTemplateSettings(settings);
    setTemplateOpen(true);
  }

  async function handleDownload(cert: Certificate, kind: "png" | "pdf", lang: "fa" | "en") {
    const url = kind === "png" ? await fetchCertificateImageObjectUrl(cert.id, lang) : await fetchCertificatePdfObjectUrl(cert.id, lang);
    download(url, `certificate-${cert.code}.${kind === "png" ? "png" : "pdf"}`);
  }

  return (
    <div className="p-5 lg:p-7 max-w-[1100px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <StarIcon className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-extrabold">گواهی‌ها</h1>
          </div>
          <p className="text-[13.5px] text-muted mt-1">آرشیو گواهی‌های صادرشده برای پرسنل و مخاطبان — با کد رهگیری و لینک استعلام عمومی</p>
        </div>
        <div className="flex items-center gap-2">
          {isManager ? (
            <button
              onClick={openTemplateSettings}
              className="text-[12.5px] font-bold text-ink-soft bg-slate-100 px-3.5 py-2.5 rounded-xl cursor-pointer"
            >
              تنظیمات قالب گواهی
            </button>
          ) : null}
          <button
            onClick={() => setNewOpen(true)}
            className="flex items-center gap-1.5 text-[12.5px] font-bold text-white bg-primary px-4 py-2.5 rounded-xl cursor-pointer"
          >
            <PlusIcon className="w-4 h-4" />
            صدور گواهی جدید
          </button>
        </div>
      </div>

      <Card className="mt-6 p-0 overflow-hidden">
        <div className="p-4 border-b border-border">
          <div className="relative max-w-[320px]">
            <SearchIcon className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="جستجو با کد گواهی یا نام گیرنده..."
              className="w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl pr-9 pl-3.5 py-2.5 focus:border-primary transition-colors"
            />
          </div>
        </div>

        {certificates === null ? (
          <div className="p-10 text-center text-[13px] text-muted">در حال بارگذاری...</div>
        ) : certificates.length === 0 ? (
          <div className="p-10 text-center text-[13px] text-muted">هنوز گواهی‌ای صادر نشده است</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-[11.5px] text-muted border-b border-border">
                  <th className="text-right font-semibold px-4 py-2.5">کد گواهی</th>
                  <th className="text-right font-semibold px-4 py-2.5">نام گیرنده</th>
                  <th className="text-right font-semibold px-4 py-2.5">عنوان</th>
                  <th className="text-right font-semibold px-4 py-2.5">تاریخ صدور</th>
                  <th className="text-right font-semibold px-4 py-2.5">صادرکننده</th>
                  <th className="text-right font-semibold px-4 py-2.5">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {certificates.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 font-bold" dir="ltr">
                      {c.code}
                    </td>
                    <td className="px-4 py-2.5">{c.recipientNameFa}</td>
                    <td className="px-4 py-2.5">{c.titleFa}</td>
                    <td className="px-4 py-2.5">{formatJalaliDate(c.createdAt)}</td>
                    <td className="px-4 py-2.5 text-muted">{c.issuedByName ?? c.issuedBy?.name ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          onClick={() => handleDownload(c, "png", "fa")}
                          className="text-[11px] font-bold text-primary bg-primary-soft px-2 py-1 rounded-lg cursor-pointer"
                        >
                          تصویر فا
                        </button>
                        <button
                          onClick={() => handleDownload(c, "png", "en")}
                          className="text-[11px] font-bold text-primary bg-primary-soft px-2 py-1 rounded-lg cursor-pointer"
                        >
                          تصویر EN
                        </button>
                        <button
                          onClick={() => handleDownload(c, "pdf", "fa")}
                          className="text-[11px] font-bold text-accent bg-accent-soft px-2 py-1 rounded-lg cursor-pointer"
                        >
                          PDF فا
                        </button>
                        <button
                          onClick={() => handleDownload(c, "pdf", "en")}
                          className="text-[11px] font-bold text-accent bg-accent-soft px-2 py-1 rounded-lg cursor-pointer"
                        >
                          PDF EN
                        </button>
                        <DeleteRecordButtonInline onDelete={() => deleteCertificate(c.id)} onDeleted={reload} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {newOpen ? (
        <NewCertificateModal
          onClose={() => setNewOpen(false)}
          onCreated={() => {
            reload();
          }}
        />
      ) : null}

      {templateOpen && templateSettings ? (
        <CertificateTemplateSettingsModal
          initialSettings={templateSettings}
          onClose={() => setTemplateOpen(false)}
          onSaved={() => reload()}
        />
      ) : null}
    </div>
  );
}

/** نسخه‌ی فشرده‌ی DeleteRecordButton برای داخل سلول جدول — بدون بوردر بالا/فاصله‌ی استاندارد. */
function DeleteRecordButtonInline({ onDelete, onDeleted }: { onDelete: () => Promise<unknown>; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        if (!window.confirm("این گواهی برای همیشه حذف شود؟")) return;
        setBusy(true);
        try {
          await onDelete();
          onDeleted();
        } finally {
          setBusy(false);
        }
      }}
      className="text-[11px] font-bold text-danger bg-danger-soft px-2 py-1 rounded-lg cursor-pointer disabled:opacity-50"
    >
      {busy ? "..." : "حذف"}
    </button>
  );
}
