"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { SignaturePad } from "@/components/ui/SignaturePad";
import { SignatureConsentNotice } from "@/components/ui/SignatureConsentNotice";
import { useActiveMembershipId } from "@/lib/agent-active";
import { fileToDataUri, AVATAR_IMAGE, uploadErrorMessage } from "@/lib/upload";
import {
  AGENT_STAGES, AGENT_STAGE_LABELS, agentsMe, agentsMeAcceptAgreement, agentsMeAgreement, agentsMeConfirmChange, agentsMeCustomers, agentsMeFunnel,
  agentsMeCard, agentsMePayments, agentsMeRenewals, agentsMeRules, agentsMeWallet, AGENT_RULE_OCCURRENCE_LABELS, type AgentMyRule, agentsMeRequestChange, agentsMeUpdate, type AgentCustomer, type AgentFunnelStage, type AgentFunnelSummary, type AgentMembership,
  type AgentPayment, type AgentProfile, type AgentRenewalRow,
} from "@/lib/api";
import { btnGhost, btnPrimary, CopyButton, errMsg, Field, fa, fmtDate, fmtMoney, inputClass, LevelBadge, Loading, SensitiveChange, StageBadge, StatusBadge, TabBar } from "./agent-ui";
import { WalletView } from "./CommissionPanel";
import { AgentPayoutsBox, BusinessCardView } from "./PayoutsPanel";

type Tab = "summary" | "wallet" | "card" | "customers" | "payments" | "renewals" | "funnel" | "profile";
type Me = Omit<AgentProfile, "audit">;

/** پنل نماینده: همه‌ی داده‌ها به‌ازای «محصول فعال» (عضویت) و فقط از مسیرهای agents/me که سرور دامنه‌ی خودش را اعمال می‌کند. */
export function AgentPortal() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActive] = useActiveMembershipId();
  const [tab, setTab] = useState<Tab>("summary");

  const load = useCallback(() => {
    agentsMe().then(setMe).catch((e) => setError(errMsg(e, "بارگذاری پنل نماینده ناموفق بود")));
  }, []);
  useEffect(load, [load]);

  const membership = useMemo(() => me?.memberships.find((m) => m.id === activeId) ?? me?.memberships[0] ?? null, [me, activeId]);
  useEffect(() => {
    if (membership && membership.id !== activeId) setActive(membership.id);
  }, [membership, activeId, setActive]);

  if (error) return <div className="py-10 text-center text-sm text-danger">{error}</div>;
  if (!me) return <Loading rows={null} />;

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4 flex items-center gap-3">
        <div className="w-14 h-14 rounded-full bg-slate-100 overflow-hidden shrink-0 flex items-center justify-center text-lg font-extrabold text-primary">
          {me.logoUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={me.logoUrl} alt="" className="w-full h-full object-cover" /> : me.contact.name.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-extrabold truncate">{me.contact.name}</div>
          <div className="text-[12px] text-muted truncate">{me.contact.company ?? "—"} · <span dir="ltr">{me.contact.phone}</span></div>
        </div>
        {me.isVerified ? <Badge tone="success">احراز شده</Badge> : null}
      </Card>

      {me.memberships.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted">هنوز در هیچ محصولی عضو نیستید؛ با مدیر تماس بگیرید.</Card>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {me.memberships.map((m) => (
              <button
                key={m.id}
                onClick={() => setActive(m.id)}
                className={`shrink-0 text-[12.5px] font-bold px-3.5 min-h-[40px] rounded-xl border cursor-pointer ${membership?.id === m.id ? "bg-primary text-white border-primary" : "bg-white text-ink-soft border-border"}`}
              >
                {m.product.name}
              </button>
            ))}
          </div>

          {membership ? <MembershipBanner m={membership} onChanged={load} /> : null}

          <TabBar
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "summary", label: "خلاصه" },
              { id: "wallet", label: "کیف پول و تسویه" },
              { id: "card", label: "کارت ویزیت" },
              { id: "customers", label: "مشتریان" },
              { id: "payments", label: "پرداخت‌ها" },
              { id: "renewals", label: "فرصت‌های تمدید" },
              { id: "funnel", label: "قیف" },
              { id: "profile", label: "پروفایل من" },
            ]}
          />
          {membership && tab === "summary" ? <SummaryTab key={membership.id} m={membership} /> : null}
          {membership && tab === "wallet" ? <MyWallet key={membership.id} m={membership} /> : null}
          {membership && tab === "card" ? <MyCard key={membership.id} m={membership} /> : null}
          {membership && tab === "customers" ? <CustomersTab key={membership.id} m={membership} /> : null}
          {membership && tab === "payments" ? <PaymentsTab key={membership.id} m={membership} /> : null}
          {membership && tab === "renewals" ? <RenewalsTab key={membership.id} m={membership} /> : null}
          {membership && tab === "funnel" ? <FunnelTab key={membership.id} m={membership} /> : null}
          {tab === "profile" ? <ProfileTab me={me} onChanged={load} /> : null}
        </>
      )}
    </div>
  );
}

function MembershipBanner({ m, onChanged }: { m: AgentMembership; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const needs = m.agreement.status === "REQUIRED" || m.agreement.status === "REACCEPT_REQUIRED";
  return (
    <>
      {m.status === "ENDED" ? <Card className="p-3 text-[12.5px] text-ink-soft bg-slate-50">همکاری شما در این محصول پایان یافته است؛ سوابق مشتریان و پرداخت‌ها فقط برای مشاهده در دسترس است.</Card> : null}
      {m.status === "SUSPENDED" ? <Card className="p-3 text-[12.5px] text-danger bg-danger-soft">عضویت شما در این محصول موقتاً معلق است.</Card> : null}
      {m.status === "PENDING" ? <Card className="p-3 text-[12.5px] text-warning bg-warning-soft">عضویت شما در انتظار فعال‌سازی توسط مدیر است.</Card> : null}
      {needs && m.status !== "ENDED" ? (
        <Card className="p-3 flex items-center justify-between gap-3 bg-warning-soft border-warning/30">
          <div className="text-[12.5px] font-semibold text-ink">
            {m.agreement.status === "REACCEPT_REQUIRED" ? "نسخه‌ی جدید تفاهم‌نامه منتشر شده؛ پذیرش مجدد لازم است." : "تفاهم‌نامه‌ی همکاری هنوز امضا نشده است."}
          </div>
          <button className={btnPrimary} onClick={() => setOpen(true)}>مطالعه و امضا</button>
        </Card>
      ) : null}
      {open ? <AgreementModal membershipId={m.id} onClose={() => setOpen(false)} onDone={() => { setOpen(false); onChanged(); }} /> : null}
    </>
  );
}

function AgreementModal({ membershipId, onClose, onDone }: { membershipId: string; onClose: () => void; onDone: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof agentsMeAgreement>> | null>(null);
  const [name, setName] = useState("");
  const [sig, setSig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { agentsMeAgreement(membershipId).then(setData).catch((e) => setErr(errMsg(e))); }, [membershipId]);

  async function accept() {
    if (!data?.agreement || !sig) return;
    setBusy(true); setErr(null);
    try {
      await agentsMeAcceptAgreement(membershipId, { agreementId: data.agreement.id, signerName: name.trim(), signatureDataUrl: sig });
      onDone();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <Modal title="تفاهم‌نامه‌ی همکاری" onClose={onClose} width="max-w-[640px]">
      {!data ? <Loading rows={data} /> : !data.agreement ? <div className="text-sm text-muted">تفاهم‌نامه‌ای منتشر نشده است.</div> : (
        <div className="flex flex-col gap-3">
          <div className="text-[13px] font-extrabold">{data.agreement.title} <span className="text-muted font-normal">· نسخه‌ی {fa(data.agreement.version)}</span></div>
          <div className="text-[13px] leading-7 whitespace-pre-wrap bg-slate-50 rounded-xl p-3 max-h-[40dvh] overflow-y-auto">{data.agreement.body}</div>
          {data.accepted ? <div className="text-[12.5px] text-success font-bold">این نسخه را در {fmtDate(data.acceptedAt)} پذیرفته‌اید.</div> : (
            <>
              <Field label="نام و نام خانوادگی امضاکننده"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></Field>
              {sig ? (
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sig} alt="امضا" className="h-16 border border-border rounded-lg bg-white" />
                  <button className={btnGhost} onClick={() => setSig(null)}>امضای دوباره</button>
                </div>
              ) : <SignaturePad onDone={setSig} />}
              <SignatureConsentNotice />
              <button className={btnPrimary} disabled={busy || !sig || name.trim().length < 2} onClick={accept}>{busy ? "در حال ثبت..." : "می‌پذیرم و امضا می‌کنم"}</button>
            </>
          )}
          {err ? <div className="text-[12px] text-danger">{err}</div> : null}
        </div>
      )}
    </Modal>
  );
}

function SummaryTab({ m }: { m: AgentMembership }) {
  const [f, setF] = useState<AgentFunnelSummary | null>(null);
  useEffect(() => { agentsMeFunnel(m.id).then(setF).catch(() => setF(null)); }, [m.id]);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="مشتریان" value={f ? fa(f.total) : "…"} />
        <Stat label="فروش خالص" value={f ? fmtMoney(f.netSales) : "…"} />
        <Stat label="پرداخت‌ها" value={f ? fa(f.paymentCount) : "…"} />
        <Stat label="تمدید‌کرده" value={f ? fa(f.counts.RENEWED) : "…"} />
      </div>
      <Card className="p-4 grid sm:grid-cols-2 gap-3 text-[13px]">
        <div className="flex items-center gap-2">سطح: <LevelBadge level={m.level} /> وضعیت: <StatusBadge status={m.status} /></div>
        <div className="flex items-center gap-2">کد معرف: {m.referralCode ? (<><b dir="ltr" className="font-mono">{m.referralCode}</b><CopyButton text={m.referralCode} /></>) : <span className="text-muted">هنوز ثبت نشده</span>}</div>
        <div className="text-muted text-[12px]">مهلت نگهداری کمیسیون: {fa(m.product.holdDays ?? 7)} روز · حداقل مبلغ تسویه: {fmtMoney(m.product.minSettlementAmount ?? 0)}</div>
        <div>تفاهم‌نامه: {m.agreement.status === "ACCEPTED" ? <Badge tone="success">پذیرفته‌شده (نسخه {fa(m.agreement.acceptedVersion ?? 0)})</Badge> : m.agreement.status === "NONE" ? <Badge>بدون تفاهم‌نامه</Badge> : <Badge tone="warning">نیازمند امضا</Badge>}</div>
      </Card>
      <MyRules key={m.id} m={m} />
    </div>
  );
}

/** درصدهای پورسانت سطح فعلی من در این محصول (فقط‌خواندنی). */
function MyRules({ m }: { m: AgentMembership }) {
  const [rules, setRules] = useState<AgentMyRule[] | null>(null);
  useEffect(() => { agentsMeRules(m.id).then(setRules).catch(() => setRules([])); }, [m.id]);
  return (
    <Card className="p-4 flex flex-col gap-2">
      <div className="font-bold text-[13px]">پورسانت من در این محصول</div>
      {rules === null ? <Loading rows={rules} /> : !rules.length ? <div className="text-[12.5px] text-muted">هنوز قانون پورسانتی برای سطح شما تعریف نشده است.</div> : (
        <div className="flex flex-col gap-1.5">
          {rules.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] border border-border rounded-xl px-3 py-2">
              <span className="font-bold">{r.txTypeName ?? "هر خرید"}{r.itemName ? ` — ${r.itemName}` : ""}</span>
              <span className="text-ink-soft">{AGENT_RULE_OCCURRENCE_LABELS[r.occurrence]}</span>
              <span className="font-extrabold text-primary">{fa(r.percent)}٪</span>
              {r.state === "SCHEDULED" ? <span className="text-muted text-[11.5px]">از {fmtDate(r.effectiveFrom)}</span> : null}
            </div>
          ))}
          <div className="text-[11.5px] text-muted">درصد از مبلغ خالص پرداخت مشتری (بعد از تخفیف، بدون مالیات)، فقط تا زمانی که همکاری شما فعال است.</div>
        </div>
      )}
    </Card>
  );
}

function MyWallet({ m }: { m: AgentMembership }) {
  const page = useCallback((cursor?: string) => agentsMeWallet(m.id, cursor), [m.id]);
  const [v, setV] = useState(0);
  return (
    <div className="flex flex-col gap-3">
      <AgentPayoutsBox membershipId={m.id} minSettlement={m.product.minSettlementAmount ?? 0} onChanged={() => setV((x) => x + 1)} />
      <WalletView key={v} fetchPage={page} minSettlement={m.product.minSettlementAmount} />
    </div>
  );
}

function MyCard({ m }: { m: AgentMembership }) {
  const fetchCard = useCallback(() => agentsMeCard(m.id), [m.id]);
  return <Card className="p-4"><BusinessCardView fetchCard={fetchCard} /></Card>;
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <Card className="p-4"><div className="text-[11.5px] text-muted">{label}</div><div className="text-[17px] font-extrabold mt-1">{value}</div></Card>
);

function CustomersTab({ m }: { m: AgentMembership }) {
  const [items, setItems] = useState<AgentCustomer[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [stage, setStage] = useState("");
  const [q, setQ] = useState("");
  const load = useCallback((more = false, cur?: string | null) => {
    agentsMeCustomers(m.id, { stage: stage || undefined, q: q.trim() || undefined, cursor: more ? cur ?? undefined : undefined })
      .then((r) => { setItems((prev) => (more ? [...(prev ?? []), ...r.items] : r.items)); setCursor(r.nextCursor); })
      .catch(() => setItems([]));
  }, [m.id, stage, q]);
  useEffect(() => { const t = setTimeout(() => load(), 250); return () => clearTimeout(t); }, [load]);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 flex-wrap">
        <input className={`${inputClass} sm:max-w-[260px]`} placeholder="جستجوی نام یا شماره" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={`${inputClass} sm:max-w-[180px]`} value={stage} onChange={(e) => setStage(e.target.value)}>
          <option value="">همه‌ی مراحل</option>
          {AGENT_STAGES.map((s) => <option key={s} value={s}>{AGENT_STAGE_LABELS[s]}</option>)}
        </select>
      </div>
      {!items?.length ? <Loading rows={items} /> : (
        <div className="flex flex-col gap-2">
          {items.map((c) => (
            <Card key={c.id} className="p-3.5 grid sm:grid-cols-[1.4fr_1fr_1fr_1fr_auto] gap-2 items-center text-[12.5px]">
              <div className="min-w-0"><div className="font-bold truncate">{c.name}</div><div className="text-muted text-[11.5px] truncate">{c.planName ?? "بدون پلن"}</div></div>
              <div>{c.phone ? <a href={`tel:${c.phone}`} dir="ltr" className="text-primary font-semibold">{c.phone}</a> : <span className="text-muted">—</span>}</div>
              <div><StageBadge stage={c.funnelStage} />{c.status === "CANCELLED" ? <Badge tone="danger" className="ms-1">لغو</Badge> : null}</div>
              <div className="text-muted text-[11.5px]">آخرین پرداخت: {fmtDate(c.lastPaymentAt)}</div>
              <div className="text-[11.5px]">تمدید: <b>{fmtDate(c.nextRenewalAt)}</b></div>
            </Card>
          ))}
          {cursor ? <button className={btnGhost} onClick={() => load(true, cursor)}>نمایش بیشتر</button> : null}
        </div>
      )}
    </div>
  );
}

function PaymentsTab({ m }: { m: AgentMembership }) {
  const [items, setItems] = useState<AgentPayment[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const load = useCallback((more = false, cur?: string | null) => {
    agentsMePayments(m.id, more ? cur ?? undefined : undefined).then((r) => { setItems((p) => (more ? [...(p ?? []), ...r.items] : r.items)); setCursor(r.nextCursor); }).catch(() => setItems([]));
  }, [m.id]);
  useEffect(() => { load(); }, [load]);
  if (!items?.length) return <Loading rows={items} />;
  return (
    <div className="flex flex-col gap-2">
      {items.map((p) => (
        <Card key={p.id} className="p-3.5 flex items-center justify-between gap-3 text-[12.5px]">
          <div className="min-w-0"><div className="font-bold truncate">{p.customer.name}</div><div className="text-muted text-[11.5px]">{p.planName ?? "—"} · {fmtDate(p.paidAt)}</div></div>
          <Badge tone={p.type === "REFUND" ? "danger" : p.type === "PAYMENT_FIRST" ? "success" : "primary"}>{p.type === "REFUND" ? "بازپرداخت" : p.type === "PAYMENT_FIRST" ? "پرداخت اول" : "تمدید"}</Badge>
          <div className={`font-extrabold shrink-0 ${p.type === "REFUND" ? "text-danger" : ""}`} dir="ltr">{p.type === "REFUND" ? "−" : ""}{fmtMoney(p.amount)}</div>
        </Card>
      ))}
      {cursor ? <button className={btnGhost} onClick={() => load(true, cursor)}>نمایش بیشتر</button> : null}
    </div>
  );
}

function RenewalsTab({ m }: { m: AgentMembership }) {
  const [rows, setRows] = useState<AgentRenewalRow[] | null>(null);
  const [now] = useState(() => Date.now());
  useEffect(() => { agentsMeRenewals(m.id).then(setRows).catch(() => setRows([])); }, [m.id]);
  if (!rows?.length) return <Loading rows={rows} />;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[12px] text-muted">مشتریانی که پایان دوره‌شان در ۶۰ روز آینده است. پیامک یادآور ۳۰ و ۷ روز مانده به شماره‌ی شما ارسال می‌شود.</div>
      {rows.map((r) => {
        const days = Math.ceil((new Date(r.nextRenewalAt).getTime() - now) / 86_400_000);
        return (
          <Card key={r.id} className="p-3.5 flex items-center justify-between gap-3 text-[12.5px]">
            <div className="min-w-0"><div className="font-bold truncate">{r.name}</div><div className="text-muted text-[11.5px]">{r.planName ?? "—"}</div></div>
            {r.phone ? <a href={`tel:${r.phone}`} dir="ltr" className="text-primary font-semibold">{r.phone}</a> : null}
            <Badge tone={days <= 7 ? "danger" : days <= 30 ? "warning" : "neutral"}>{days < 0 ? `${fa(-days)} روز گذشته` : `${fa(days)} روز مانده`} · {fmtDate(r.nextRenewalAt)}</Badge>
          </Card>
        );
      })}
    </div>
  );
}

function FunnelTab({ m }: { m: AgentMembership }) {
  const [f, setF] = useState<AgentFunnelSummary | null>(null);
  const [items, setItems] = useState<AgentCustomer[] | null>(null);
  useEffect(() => {
    agentsMeFunnel(m.id).then(setF).catch(() => setF(null));
    agentsMeCustomers(m.id).then((r) => setItems(r.items)).catch(() => setItems([]));
  }, [m.id]);
  if (!f) return <Loading rows={null} />;
  const by = (s: AgentFunnelStage) => (items ?? []).filter((c) => c.funnelStage === s).slice(0, 5);
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {AGENT_STAGES.map((s) => (
        <div key={s} className="shrink-0 w-[210px] flex flex-col gap-2">
          <div className="flex items-center justify-between"><StageBadge stage={s} /><b className="text-[13px]">{fa(f.counts[s])}</b></div>
          {by(s).map((c) => (
            <Card key={c.id} className="p-2.5 text-[12px]"><div className="font-bold truncate">{c.name}</div><div className="text-muted text-[11px] truncate">{c.planName ?? "—"}</div></Card>
          ))}
          {f.counts[s] > 5 ? <div className="text-[11px] text-muted text-center">و {fa(f.counts[s] - 5)} مورد دیگر</div> : null}
        </div>
      ))}
    </div>
  );
}

function ProfileTab({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [name, setName] = useState(me.contact.name);
  const [city, setCity] = useState(me.city ?? "");
  const [bio, setBio] = useState(me.bio ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [change, setChange] = useState<"SHEBA" | "PHONE" | null>(null);

  async function save(extra: { logoUrl?: string } = {}) {
    setBusy(true); setMsg(null);
    try { await agentsMeUpdate({ name: name.trim(), city: city.trim(), bio: bio.trim(), ...extra }); setMsg("ذخیره شد"); onChanged(); } catch (e) { setMsg(errMsg(e)); } finally { setBusy(false); }
  }
  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    try { await save({ logoUrl: await fileToDataUri(file, "image", AVATAR_IMAGE) }); } catch (e) { setMsg(uploadErrorMessage(e)); }
  }
  return (
    <Card className="p-4 flex flex-col gap-3.5 max-w-[560px]">
      <Field label="عکس نماینده"><input type="file" accept="image/*" className="text-[12px]" onChange={(e) => void pickPhoto(e.target.files?.[0])} /></Field>
      <Field label="نام"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="شهر"><input className={inputClass} value={city} onChange={(e) => setCity(e.target.value)} /></Field>
      <Field label="معرفی کوتاه"><textarea className={inputClass} rows={3} value={bio} onChange={(e) => setBio(e.target.value)} /></Field>
      <div className="flex items-center gap-3"><button className={btnPrimary} disabled={busy} onClick={() => save()}>ذخیره</button>{msg ? <span className="text-[12px] text-ink-soft">{msg}</span> : null}</div>
      <hr className="border-border" />
      <div className="text-[13px]">شماره‌ی تماس: <b dir="ltr">{me.contact.phone}</b> <button className="text-primary text-[12px] font-bold ms-2 cursor-pointer" onClick={() => setChange(change === "PHONE" ? null : "PHONE")}>تغییر</button></div>
      {change === "PHONE" ? <SensitiveChange kind="PHONE" request={agentsMeRequestChange} confirm={agentsMeConfirmChange} onDone={() => { setChange(null); onChanged(); }} /> : null}
      <div className="text-[13px]">شماره‌ی شبا: <b dir="ltr">{me.shabaMasked ?? "ثبت نشده"}</b> <button className="text-primary text-[12px] font-bold ms-2 cursor-pointer" onClick={() => setChange(change === "SHEBA" ? null : "SHEBA")}>{me.hasSheba ? "تغییر" : "ثبت"}</button></div>
      {me.pendingSheba ? <div className="text-[12px] text-warning">شبای جدید <b dir="ltr">{me.pendingSheba.shabaMasked}</b> ثبت شد و پس از تأیید مدیر جایگزین می‌شود؛ تا آن زمان واریزها به شبای فعلی است.</div> : null}
      {change === "SHEBA" ? <SensitiveChange kind="SHEBA" request={agentsMeRequestChange} confirm={agentsMeConfirmChange} onDone={() => { setChange(null); onChanged(); }} /> : null}
    </Card>
  );
}
