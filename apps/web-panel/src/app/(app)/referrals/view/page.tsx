"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { InvoiceDetailModal } from "@/components/sales/InvoiceDetailModal";
import { QuotationDetailModal } from "@/components/sales/QuotationDetailModal";
import { PurchaseOrderDetailModal } from "@/components/purchasing/PurchaseOrderDetailModal";
import { DealModal } from "@/components/crm/DealModal";
import { ContactModal } from "@/components/crm/ContactModal";
import { ProposalDetailModal } from "@/components/proposals/ProposalDetailModal";
import { ContractDetailModal } from "@/components/contracts/ContractDetailModal";
import { ProjectDetailModal } from "@/components/projects/ProjectDetailModal";
import { ReportDetailModal } from "@/components/reports/ReportDetailModal";
import { Modal } from "@/components/ui/Modal";
import { fetchContract, fetchProject, type Contract, type Project } from "@/lib/api";

/**
 * نمایش یک سند از روی لینک اعلان/ارجاع/وظیفه: /referrals/view?type=SalesInvoice&id=...
 * صفحه‌ی ماژولِ مبدأ برای کسی که آن ماژول را در منو ندارد مسدود است؛ این مسیر مستقل از ماژول است و
 * دسترسی را سرور (ارجاع فعال یا وظیفه‌ی پیوندخورده) تعیین می‌کند.
 */
function Viewer() {
  const router = useRouter();
  const params = useSearchParams();
  const type = params.get("type") ?? "";
  const id = params.get("id") ?? "";
  const [contract, setContract] = useState<Contract | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!id) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(false);
    if (type === "Contract") fetchContract(id).then(setContract).catch(() => setError(true));
    if (type === "Project") fetchProject(id).then(setProject).catch(() => setError(true));
  }, [type, id]);

  const close = () => router.push("/referrals");
  const noop = () => undefined;

  if (!type || !id || error) {
    return (
      <Modal title="سند" onClose={close}>
        <div className="py-8 text-center text-[13px] text-muted">سند یافت نشد یا اجازه‌ی مشاهده‌ی آن را ندارید.</div>
      </Modal>
    );
  }
  switch (type) {
    case "SalesInvoice":
      return <InvoiceDetailModal invoiceId={id} onClose={close} onChanged={noop} />;
    case "SalesQuotation":
      return <QuotationDetailModal quotationId={id} onClose={close} onChanged={noop} onConverted={(invoiceId) => router.push(`/referrals/view?type=SalesInvoice&id=${invoiceId}`)} />;
    case "PurchaseOrder":
      return <PurchaseOrderDetailModal orderId={id} onClose={close} onChanged={noop} />;
    case "CrmDeal":
      return <DealModal dealId={id} onClose={close} onChanged={noop} onDeleted={close} />;
    case "CrmContact":
      return <ContactModal contactId={id} onClose={close} onNewDeal={noop} onDeleted={close} />;
    case "Proposal":
      return <ProposalDetailModal id={id} onClose={close} onChanged={noop} onEdit={(pid) => router.push(`/proposals?id=${pid}`)} />;
    case "Report":
      return <ReportDetailModal id={id} onClose={close} onChanged={noop} />;
    case "Contract":
      return contract ? <ContractDetailModal contract={contract} onClose={close} onChanged={noop} /> : <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>;
    case "Project":
      return project ? <ProjectDetailModal project={project} onClose={close} onChanged={noop} /> : <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>;
    default:
      return (
        <Modal title="سند" onClose={close}>
          <div className="py-8 text-center text-[13px] text-muted">این نوع سند قابل نمایش نیست.</div>
        </Modal>
      );
  }
}

export default function ReferralViewPage() {
  return (
    <Suspense fallback={null}>
      <Viewer />
    </Suspense>
  );
}
