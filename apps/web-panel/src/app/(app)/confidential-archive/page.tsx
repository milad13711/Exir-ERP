"use client";

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/Card";
import { KeyIcon, PlusIcon } from "@/components/icons";
import { useWorkspace } from "@/lib/workspace-context";
import {
  fetchMyArchiveAccess,
  fetchConfidentialDocuments,
  CONFIDENTIAL_DOCUMENT_CATEGORY_LABELS,
  ApiError,
  type ConfidentialDocument,
} from "@/lib/api";
import { formatJalaliDate } from "@/lib/persian";
import { NewDocumentModal } from "@/components/confidential-archive/NewDocumentModal";
import { OtpStepUpModal } from "@/components/confidential-archive/OtpStepUpModal";
import { AccessSettingsModal } from "@/components/confidential-archive/AccessSettingsModal";
import { DocumentDetailModal } from "@/components/confidential-archive/DocumentDetailModal";

type MyAccess = { isManager: boolean; hasAccess: boolean; canEdit: boolean };

export default function ConfidentialArchivePage() {
  const { me } = useWorkspace();
  const isManager = me?.user.membershipRole === "OWNER" || me?.user.membershipRole === "ADMIN";

  const [myAccess, setMyAccess] = useState<MyAccess | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [otpOpen, setOtpOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);

  // بلیط طاق فقط در state (نه localStorage) — با رفرش صفحه پاک می‌شود، دقیقاً طبق طراحی امنیتی
  const [vaultTicket, setVaultTicket] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [documents, setDocuments] = useState<ConfidentialDocument[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailDoc, setDetailDoc] = useState<ConfidentialDocument | null>(null);

  useEffect(() => {
    fetchMyArchiveAccess()
      .then(setMyAccess)
      .catch(() => setMyAccess({ isManager: false, hasAccess: false, canEdit: false }));
  }, []);

  const loadDocuments = useCallback((ticket: string) => {
    fetchConfidentialDocuments(ticket)
      .then((docs) => {
        setDocuments(docs);
        setLoadError(null);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          // نشست آرشیو منقضی شده — دوباره باید کد پیامکی تأیید شود
          setVaultTicket(null);
          setDocuments(null);
        } else {
          setLoadError(err instanceof ApiError ? err.message : "بارگذاری اسناد ناموفق بود");
        }
      });
  }, []);

  function handleVerified(ticket: string, editable: boolean) {
    setVaultTicket(ticket);
    setCanEdit(editable);
    setOtpOpen(false);
    loadDocuments(ticket);
  }

  function handleExpired() {
    setVaultTicket(null);
    setDocuments(null);
    setDetailDoc(null);
  }

  const canEnterArchive = !!myAccess && (myAccess.isManager || myAccess.hasAccess);
  const inArchive = !!vaultTicket && documents !== null;

  return (
    <div className="p-5 lg:p-7 max-w-[1100px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <KeyIcon className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-extrabold">بایگانی اسناد محرمانه</h1>
          </div>
          <p className="text-[13.5px] text-muted mt-1">
            رمز عبور، دانش فنی، فرمولاسیون، قرارداد محرمانه و ریز لاگ سیستم — ثبت سند برای همه آزاد است، مشاهده‌ی آرشیو فقط برای کاربران مجاز و با تأیید پیامکی.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isManager ? (
            <button
              onClick={() => setAccessOpen(true)}
              className="text-[12.5px] font-bold text-ink-soft bg-slate-100 px-3.5 py-2.5 rounded-xl cursor-pointer"
            >
              مدیریت دسترسی
            </button>
          ) : null}
          <button
            onClick={() => setNewOpen(true)}
            className="flex items-center gap-1.5 text-[12.5px] font-bold text-white bg-primary px-4 py-2.5 rounded-xl cursor-pointer"
          >
            <PlusIcon className="w-4 h-4" />
            ثبت سند جدید
          </button>
        </div>
      </div>

      <Card className="mt-5 p-5">
        {!inArchive ? (
          <div className="flex flex-col items-center text-center gap-3 py-8">
            <KeyIcon className="w-8 h-8 text-muted" />
            {myAccess === null ? (
              <p className="text-[13px] text-muted">در حال بررسی دسترسی…</p>
            ) : canEnterArchive ? (
              <>
                <p className="text-[13.5px] font-bold">برای مشاهده‌ی اسناد ثبت‌شده، هویت خود را دوباره با کد پیامکی تأیید کنید.</p>
                <button
                  onClick={() => setOtpOpen(true)}
                  className="text-[13px] font-bold text-white bg-primary px-5 py-2.5 rounded-xl cursor-pointer"
                >
                  ورود به آرشیو
                </button>
              </>
            ) : (
              <p className="text-[13px] text-muted max-w-[420px]">
                شما هنوز مجوز مشاهده‌ی این آرشیو را ندارید. همچنان می‌توانید سند جدید ثبت کنید — برای مشاهده/ویرایش آرشیو از مالک یا مدیر محیط کاری بخواهید دسترسی بدهد.
              </p>
            )}
          </div>
        ) : (
          <>
            {loadError ? <div className="text-[12.5px] text-danger mb-3">{loadError}</div> : null}
            {documents!.length === 0 ? (
              <div className="text-[13px] text-muted text-center py-8">هنوز سندی ثبت نشده</div>
            ) : (
              <div className="border border-border rounded-xl overflow-hidden">
                {documents!.map((doc, i) => (
                  <button
                    key={doc.id}
                    onClick={() => setDetailDoc(doc)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-right hover:bg-primary-soft/40 cursor-pointer ${
                      i < documents!.length - 1 ? "border-b border-border" : ""
                    }`}
                  >
                    <div className="flex-1">
                      <div className="text-[13.5px] font-bold">{doc.title}</div>
                      <div className="text-[11.5px] text-muted mt-0.5">
                        {CONFIDENTIAL_DOCUMENT_CATEGORY_LABELS[doc.category]} · {formatJalaliDate(doc.createdAt)}
                        {doc.createdBy ? ` · ${doc.createdBy.name}` : ""}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </Card>

      {newOpen ? (
        <NewDocumentModal
          onClose={() => setNewOpen(false)}
          onCreated={() => {
            setNewOpen(false);
            if (vaultTicket) loadDocuments(vaultTicket);
          }}
        />
      ) : null}

      {otpOpen ? <OtpStepUpModal onClose={() => setOtpOpen(false)} onVerified={handleVerified} /> : null}

      {accessOpen ? <AccessSettingsModal onClose={() => setAccessOpen(false)} /> : null}

      {detailDoc && vaultTicket ? (
        <DocumentDetailModal
          doc={detailDoc}
          canEdit={canEdit}
          vaultTicket={vaultTicket}
          onClose={() => setDetailDoc(null)}
          onUpdated={(updated) => {
            setDetailDoc(updated);
            setDocuments((prev) => (prev ? prev.map((d) => (d.id === updated.id ? updated : d)) : prev));
          }}
          onDeleted={(id) => {
            setDetailDoc(null);
            setDocuments((prev) => (prev ? prev.filter((d) => d.id !== id) : prev));
          }}
          onExpired={() => {
            setDetailDoc(null);
            handleExpired();
          }}
        />
      ) : null}
    </div>
  );
}
