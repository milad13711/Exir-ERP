"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ShareIcon, PlusIcon } from "@/components/icons";
import { formatToman, toPersianDigits } from "@/lib/persian";
import {
  fetchResellers,
  fetchResellerDashboard,
  fetchMyResellerProfile,
  fetchMyReferralConversions,
  fetchMyReferralCommissions,
  fetchMySupportTickets,
  type Reseller,
  type ResellerDashboardRow,
  type ReferralConversion,
  type ReferralCommission,
  type ResellerSupportTicket,
} from "@/lib/api";
import { NewResellerModal } from "@/components/referral-marketing/NewResellerModal";
import { ResellerDetailModal } from "@/components/referral-marketing/ResellerDetailModal";
import { ModuleHelp } from "@/components/ui/ModuleHelp";

type Tab = "resellers" | "dashboard" | "me";

export default function ReferralMarketingPage() {
  const [hasManagementAccess, setHasManagementAccess] = useState<boolean | null>(null);
  const [isReseller, setIsReseller] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("resellers");

  useEffect(() => {
    fetchResellers()
      .then(() => setHasManagementAccess(true))
      .catch(() => setHasManagementAccess(false));
    fetchMyResellerProfile()
      .then(() => setIsReseller(true))
      .catch(() => setIsReseller(false));
  }, []);

  useEffect(() => {
    if (hasManagementAccess === false && isReseller === true) setTab("me");
  }, [hasManagementAccess, isReseller]);

  return (
    <div className="p-5 lg:p-7 max-w-[1100px] mx-auto">
      <div className="flex items-center gap-1.5">
        <h1 className="text-xl font-extrabold">نمایندگی و بازاریابی رفرال</h1>
        <ModuleHelp code="referral-marketing" />
      </div>
      <p className="text-[13.5px] text-muted mt-1">
        شبکه‌ی نمایندگان/همکار فروشی که مشتری جدید معرفی می‌کنند و روی پرداخت اول و تمدید فاکتور مشتری، خودکار کمیسیون می‌گیرند
      </p>

      <div className="flex items-center gap-2 mt-5 mb-5">
        {hasManagementAccess ? (
          <>
            <TabButton active={tab === "resellers"} onClick={() => setTab("resellers")} label="نمایندگان" />
            <TabButton active={tab === "dashboard"} onClick={() => setTab("dashboard")} label="داشبورد مقایسه" />
          </>
        ) : null}
        {isReseller ? <TabButton active={tab === "me"} onClick={() => setTab("me")} label="پنل من" /> : null}
      </div>

      {tab === "resellers" && hasManagementAccess ? <ResellersTab /> : null}
      {tab === "dashboard" && hasManagementAccess ? <DashboardTab /> : null}
      {tab === "me" && isReseller ? <MyPanelTab /> : null}
    </div>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "text-[12.5px] font-bold px-3.5 py-2 rounded-[10px] cursor-pointer",
        active ? "bg-primary text-white" : "bg-slate-100 text-ink-soft",
      )}
    >
      {label}
    </button>
  );
}

function ResellersTab() {
  const [resellers, setResellers] = useState<Reseller[] | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  function reload() {
    fetchResellers().then(setResellers).catch(() => setResellers([]));
  }
  useEffect(reload, []);

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button
          onClick={() => setNewOpen(true)}
          className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-3.5 py-2.5 rounded-xl cursor-pointer"
        >
          <PlusIcon className="w-4 h-4" />
          نماینده‌ی جدید
        </button>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {resellers === null ? (
          <div className="py-8 text-center text-muted text-sm col-span-2">در حال بارگذاری...</div>
        ) : resellers.length === 0 ? (
          <div className="py-8 text-center text-muted text-sm col-span-2">هنوز نماینده‌ای ثبت نشده</div>
        ) : (
          resellers.map((r) => (
            <Card key={r.id} className="p-4 cursor-pointer hover:border-primary transition-colors" onClick={() => setOpenId(r.id)}>
              <div className="flex items-center justify-between">
                <div className="text-[13.5px] font-bold">{r.contact.name}</div>
                <Badge tone={r.tier === "A_PLUS" ? "primary" : r.tier === "A" ? "accent" : "neutral"}>
                  {r.tier === "A_PLUS" ? "A+" : r.tier}
                </Badge>
              </div>
              <div className="text-[12px] text-muted mt-1">{r.contact.company || "—"}</div>
              <div className="flex items-center gap-3 mt-2.5 text-[11.5px] text-ink-soft">
                <span className="flex items-center gap-1">
                  <ShareIcon className="w-3.5 h-3.5" />
                  {r.userId ? "دسترسی ورود فعال" : "بدون دسترسی ورود"}
                </span>
                {r.isVerified ? <Badge tone="success">احراز شده</Badge> : null}
              </div>
            </Card>
          ))
        )}
      </div>

      {newOpen ? <NewResellerModal onClose={() => setNewOpen(false)} onCreated={reload} /> : null}
      {openId ? <ResellerDetailModal id={openId} onClose={() => setOpenId(null)} onChanged={reload} /> : null}
    </div>
  );
}

function DashboardTab() {
  const [rows, setRows] = useState<ResellerDashboardRow[] | null>(null);
  useEffect(() => {
    fetchResellerDashboard().then(setRows).catch(() => setRows([]));
  }, []);

  const maxCommission = useMemo(() => Math.max(1, ...(rows ?? []).map((r) => r.totalCommission)), [rows]);

  return (
    <Card className="p-5">
      {rows === null ? (
        <div className="py-8 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : rows.length === 0 ? (
        <div className="py-8 text-center text-muted text-sm">داده‌ای برای مقایسه وجود ندارد</div>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3">
              <div className="w-32 shrink-0 text-[12.5px] font-semibold truncate">{r.name}</div>
              <div className="flex-1 h-6 bg-slate-100 rounded-lg overflow-hidden relative">
                <div
                  className="h-full bg-primary rounded-lg"
                  style={{ width: `${Math.max(4, (r.totalCommission / maxCommission) * 100)}%` }}
                />
              </div>
              <div className="w-24 shrink-0 text-[12px] text-left font-bold" dir="ltr">
                {formatToman(r.totalCommission)}
              </div>
              <div className="w-16 shrink-0 text-[11.5px] text-muted text-center">
                {toPersianDigits(r.referredCustomerCount)} مشتری
              </div>
              <div className="w-16 shrink-0 text-[11.5px] text-center">
                {r.npsAvgScore != null ? (
                  <span className="font-bold">{toPersianDigits(r.npsAvgScore.toFixed(1))} ⭐</span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

import { MyProfileCard } from "@/components/referral-marketing/MyProfileCard";

function MyPanelTab() {
  const [conversions, setConversions] = useState<ReferralConversion[] | null>(null);
  const [commissions, setCommissions] = useState<ReferralCommission[] | null>(null);
  const [tickets, setTickets] = useState<ResellerSupportTicket[] | null>(null);

  useEffect(() => {
    fetchMyReferralConversions().then(setConversions).catch(() => setConversions([]));
    fetchMyReferralCommissions().then(setCommissions).catch(() => setCommissions([]));
    fetchMySupportTickets().then(setTickets).catch(() => setTickets([]));
  }, []);

  const pendingCommission = (commissions ?? [])
    .filter((c) => c.purchaseOrder.paidAmount < c.amount)
    .reduce((sum, c) => sum + c.amount, 0);
  const paidCommission = (commissions ?? []).reduce((sum, c) => sum + Math.min(c.purchaseOrder.paidAmount, c.amount), 0);

  return (
    <div className="flex flex-col gap-5">
      <MyProfileCard />
      <div className="grid sm:grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-[11.5px] text-muted">مشتریان معرفی‌شده</div>
          <div className="text-xl font-extrabold mt-1">{toPersianDigits(conversions?.length ?? 0)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11.5px] text-muted">کمیسیون تسویه‌شده</div>
          <div className="text-xl font-extrabold mt-1">{formatToman(paidCommission)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11.5px] text-muted">کمیسیون تعهدی</div>
          <div className="text-xl font-extrabold mt-1">{formatToman(pendingCommission)}</div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="text-[13px] font-bold mb-3">مشتریان معرفی‌شده</div>
        <div className="flex flex-col gap-1.5">
          {(conversions ?? []).length === 0 ? (
            <div className="text-[12px] text-muted">هنوز مشتری‌ای از طریق لینک شما ثبت‌نام نکرده</div>
          ) : (
            conversions!.map((c) => (
              <div key={c.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 text-[12.5px]">
                <span className="font-semibold">{c.contact.name}</span>
                <span className="text-muted">{c.contact.company || c.contact.phone || "—"}</span>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-[13px] font-bold mb-3">گردش کمیسیون</div>
        <div className="flex flex-col gap-1.5">
          {(commissions ?? []).length === 0 ? (
            <div className="text-[12px] text-muted">هنوز کمیسیونی ثبت نشده</div>
          ) : (
            commissions!.map((c) => {
              const settled = c.purchaseOrder.paidAmount >= c.amount;
              return (
                <div key={c.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 text-[12.5px]">
                  <div>
                    <div className="font-semibold">{c.referralConversion.contact.company || c.referralConversion.contact.name}</div>
                    <div className="text-muted text-[11px] mt-0.5">{c.kind === "FIRST_PAYMENT" ? "پرداخت اول" : "تمدید"}</div>
                  </div>
                  <div className="text-left">
                    <div className="font-bold">{formatToman(c.amount)}</div>
                    <Badge tone={settled ? "success" : "warning"} className="mt-1">
                      {settled ? "تسویه‌شده" : "تعهدی"}
                    </Badge>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-[13px] font-bold mb-3">درخواست‌های پشتیبانی مشتریان پلتفرمی من</div>
        <div className="flex flex-col gap-1.5">
          {(tickets ?? []).length === 0 ? (
            <div className="text-[12px] text-muted">درخواست پشتیبانی‌ای ثبت نشده</div>
          ) : (
            tickets!.map((t) => (
              <div key={t.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 text-[12.5px]">
                <div>
                  <div className="font-semibold">{t.subject}</div>
                  <div className="text-muted text-[11px] mt-0.5">{t.tenantName}</div>
                </div>
                <Badge tone={t.status === "RESOLVED" || t.status === "CLOSED" ? "success" : "warning"}>{t.status}</Badge>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
