"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import {
  AGENT_LEVEL_LABELS, AGENT_STAGES, AGENT_STAGE_LABELS, AGENT_STATUS_LABELS, agentsAddMembership, agentsAdminCustomers, agentsAdminFunnel, agentsApplications, agentsApproveApplication,
  agentsChangeStage, agentsConfirmChange, agentsCreateProfile, agentsGetProfile, agentsListProducts, agentsListProfiles, agentsRejectApplication, agentsRequestChange,
  agentsMembershipCard, agentsMembershipWallet, agentsPayouts, agentsShebaChanges, agentsTransferCustomer, agentsUpdateMembership, agentsUpdateProfile, type AgentApplication, type AgentCustomer, type AgentFunnelStage, type AgentLevel, type AgentMembership, type AgentMembershipStatus,
  type AgentProduct, type AgentProfile,
} from "@/lib/api";
import { fileToDataUri, AVATAR_IMAGE, uploadErrorMessage } from "@/lib/upload";
import { btnDanger, btnGhost, btnPrimary, errMsg, Field, fa, fmtDate, fmtMoney, inputClass, LevelBadge, Loading, SensitiveChange, StageBadge, StatusBadge, TabBar } from "./agent-ui";
import { ProductsPanel } from "./ProductsPanel";
import { TransactionsPanel, WalletView } from "./CommissionPanel";
import { ShebaApprovals } from "./ShebaApprovals";
import { AdminPayoutsPanel, AdminRequestPayoutButton, BusinessCardView, PerformanceReportPanel } from "./PayoutsPanel";

type Tab = "agents" | "applications" | "sheba" | "products" | "transactions" | "payouts" | "reports";
const LEVELS: AgentLevel[] = ["B", "A", "A_PLUS"];

export function AgentAdmin({ canCreate, canEdit, canDelete }: { canCreate: boolean; canEdit: boolean; canDelete: boolean }) {
  const [tab, setTab] = useState<Tab>("agents");
  const [products, setProducts] = useState<AgentProduct[]>([]);
  const [pending, setPending] = useState(0);
  const reloadProducts = useCallback(() => { agentsListProducts().then(setProducts).catch(() => setProducts([])); }, []);
  useEffect(reloadProducts, [reloadProducts]);
  useEffect(() => { agentsApplications("PENDING").then((r) => setPending(r.length)).catch(() => undefined); }, [tab]);
  const [pendingSheba, setPendingSheba] = useState(0);
  const refreshShebaBadge = useCallback(() => { agentsShebaChanges("PENDING").then((r) => setPendingSheba(r.length)).catch(() => undefined); }, []);
  useEffect(refreshShebaBadge, [tab, refreshShebaBadge]);
  const [openPayouts, setOpenPayouts] = useState(0);
  const refreshPayoutBadge = useCallback(() => { agentsPayouts({ status: "REQUESTED" }).then((r) => setOpenPayouts(r.totals.find((t) => t.status === "REQUESTED")?.count ?? 0)).catch(() => undefined); }, []);
  useEffect(refreshPayoutBadge, [tab, refreshPayoutBadge]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <TabBar value={tab} onChange={setTab} tabs={[{ id: "agents", label: "نمایندگان" }, { id: "applications", label: "درخواست‌ها", badge: pending }, { id: "sheba", label: "تأیید شبا", badge: pendingSheba }, { id: "products", label: "محصولات و تفاهم‌نامه" }, { id: "transactions", label: "تراکنش‌ها و پورسانت" }, { id: "payouts", label: "تسویه‌ها", badge: openPayouts }, { id: "reports", label: "گزارش‌ها" }]} />
        <Link href="/agents/settings" className={btnGhost + " inline-flex items-center"}>تنظیمات نمایندگی (API)</Link>
      </div>
      {tab === "agents" ? <AgentsList products={products} canCreate={canCreate} canEdit={canEdit} /> : null}
      {tab === "applications" ? <Applications products={products} canEdit={canEdit} onChanged={() => agentsApplications("PENDING").then((r) => setPending(r.length)).catch(() => undefined)} /> : null}
      {tab === "products" ? <ProductsPanel products={products} onChanged={reloadProducts} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} /> : null}
      {tab === "transactions" ? <TransactionsPanel products={products} /> : null}
      {tab === "sheba" ? <ShebaApprovals canEdit={canEdit} onChanged={refreshShebaBadge} /> : null}
      {tab === "payouts" ? <AdminPayoutsPanel products={products} canEdit={canEdit} onChanged={refreshPayoutBadge} /> : null}
      {tab === "reports" ? <PerformanceReportPanel products={products} /> : null}
    </div>
  );
}

// ── فهرست نمایندگان + فیلتر ──
function AgentsList({ products, canCreate, canEdit }: { products: AgentProduct[]; canCreate: boolean; canEdit: boolean }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof agentsListProfiles>> | null>(null);
  const [productId, setProductId] = useState("");
  const [level, setLevel] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const load = useCallback(() => { agentsListProfiles({ productId, level, status, q: q.trim() }).then(setRows).catch(() => setRows([])); }, [productId, level, status, q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <input className={`${inputClass} col-span-2 sm:col-span-1`} placeholder="جستجوی نام/شماره" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={inputClass} value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">همه‌ی محصولات</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select className={inputClass} value={level} onChange={(e) => setLevel(e.target.value)}><option value="">همه‌ی سطوح</option>{LEVELS.map((l) => <option key={l} value={l}>{AGENT_LEVEL_LABELS[l]}</option>)}</select>
        <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">همه‌ی وضعیت‌ها</option>{(Object.keys(AGENT_STATUS_LABELS) as AgentMembershipStatus[]).map((s) => <option key={s} value={s}>{AGENT_STATUS_LABELS[s]}</option>)}</select>
        {canCreate ? <button className={btnPrimary} onClick={() => setNewOpen(true)}>نماینده‌ی جدید</button> : null}
      </div>
      {!rows?.length ? <Loading rows={rows} /> : (
        <div className="grid sm:grid-cols-2 gap-3">
          {rows.map((r) => (
            <Card key={r.id} className="p-4 cursor-pointer hover:border-primary transition-colors" onClick={() => setOpenId(r.id)}>
              <div className="flex items-center justify-between gap-2">
                <div className="text-[13.5px] font-bold truncate">{r.contact.name}</div>
                <div className="flex gap-1">{r.isVerified ? <Badge tone="success">احراز</Badge> : null}{r.userId ? <Badge tone="primary">ورود فعال</Badge> : <Badge tone="warning">بدون ورود</Badge>}</div>
              </div>
              <div className="text-[12px] text-muted mt-1" dir="ltr">{r.contact.phone}</div>
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {r.memberships.map((m) => (
                  <span key={m.id} className="inline-flex items-center gap-1 text-[11px] bg-slate-50 border border-border rounded-lg px-2 py-1">
                    {m.product.name} <LevelBadge level={m.level} /> <StatusBadge status={m.status} /> · {fa(m._count.customers)} مشتری
                  </span>
                ))}
                {r.memberships.length === 0 ? <span className="text-[11.5px] text-muted">بدون عضویت محصولی</span> : null}
              </div>
            </Card>
          ))}
        </div>
      )}
      {newOpen ? <NewAgentModal products={products} onClose={() => setNewOpen(false)} onCreated={(id) => { setNewOpen(false); load(); setOpenId(id); }} /> : null}
      {openId ? <AgentDetailModal id={openId} products={products} canEdit={canEdit} onClose={() => setOpenId(null)} onChanged={load} /> : null}
    </div>
  );
}

function MembershipPicker({ products, value, onChange }: { products: AgentProduct[]; value: Record<string, AgentLevel | undefined>; onChange: (v: Record<string, AgentLevel | undefined>) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {products.filter((p) => p.isActive).map((p) => (
        <div key={p.id} className="flex items-center gap-2 min-h-[40px]">
          <label className="flex items-center gap-2 flex-1 text-[13px] cursor-pointer">
            <input type="checkbox" className="w-4 h-4" checked={!!value[p.id]} onChange={(e) => onChange({ ...value, [p.id]: e.target.checked ? "B" : undefined })} />
            {p.name}
          </label>
          {value[p.id] ? <select className={`${inputClass} !w-[110px]`} value={value[p.id]} onChange={(e) => onChange({ ...value, [p.id]: e.target.value as AgentLevel })}>{LEVELS.map((l) => <option key={l} value={l}>{AGENT_LEVEL_LABELS[l]}</option>)}</select> : null}
        </div>
      ))}
    </div>
  );
}
const pickedList = (v: Record<string, AgentLevel | undefined>) => Object.entries(v).filter(([, l]) => l).map(([productId, level]) => ({ productId, level }));

function NewAgentModal({ products, onClose, onCreated }: { products: AgentProduct[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [company, setCompany] = useState(""); const [city, setCity] = useState("");
  const [picked, setPicked] = useState<Record<string, AgentLevel | undefined>>({});
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const r = await agentsCreateProfile({ name: name.trim(), phone: phone.trim(), company: company.trim() || undefined, city: city.trim() || undefined, memberships: pickedList(picked) as never }); onCreated(r.profile.id); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  return (
    <Modal title="نماینده‌ی جدید" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="نام"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="شماره‌ی موبایل (ورود نماینده)"><input className={inputClass} dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09123456789" /></Field>
        <Field label="مجموعه / شرکت"><input className={inputClass} value={company} onChange={(e) => setCompany(e.target.value)} /></Field>
        <Field label="شهر"><input className={inputClass} value={city} onChange={(e) => setCity(e.target.value)} /></Field>
        <Field label="محصولات و سطح"><MembershipPicker products={products} value={picked} onChange={setPicked} /></Field>
        {err ? <div className="text-[12px] text-danger">{err}</div> : null}
        <div className="flex justify-end gap-2"><button type="button" className={btnGhost} onClick={onClose}>انصراف</button><button className={btnPrimary} disabled={busy || name.trim().length < 2 || !phone.trim() || pickedList(picked).length === 0}>{busy ? "..." : "ثبت و اعطای ورود"}</button></div>
      </form>
    </Modal>
  );
}

// ── درخواست‌های همکاری (فرم eta.co.ir) ──
function Applications({ products, canEdit, onChanged }: { products: AgentProduct[]; canEdit: boolean; onChanged: () => void }) {
  const [rows, setRows] = useState<AgentApplication[] | null>(null);
  const [status, setStatus] = useState("PENDING");
  const [approving, setApproving] = useState<AgentApplication | null>(null);
  const load = useCallback(() => { agentsApplications(status).then(setRows).catch(() => setRows([])); }, [status]);
  useEffect(load, [load]);
  async function reject(a: AgentApplication) {
    const note = window.prompt("دلیل رد (اختیاری)") ?? undefined;
    if (note === undefined && !window.confirm("درخواست بدون دلیل رد شود؟")) return;
    try { await agentsRejectApplication(a.id, note); load(); onChanged(); } catch (e) { window.alert(errMsg(e)); }
  }
  return (
    <div className="flex flex-col gap-3">
      <select className={`${inputClass} sm:max-w-[200px]`} value={status} onChange={(e) => setStatus(e.target.value)}><option value="PENDING">در انتظار</option><option value="APPROVED">تأییدشده</option><option value="REJECTED">ردشده</option><option value="">همه</option></select>
      {!rows?.length ? <Loading rows={rows} /> : rows.map((a) => (
        <Card key={a.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div className="min-w-0 text-[12.5px]">
            <div className="font-bold text-[13.5px]">{a.name} {a.company ? <span className="text-muted font-normal">· {a.company}</span> : null}</div>
            <div className="text-muted" dir="ltr">{a.phone}{a.email ? ` · ${a.email}` : ""}</div>
            <div className="text-muted">{a.city ?? "—"} · محصول درخواستی: {a.productCode ?? "—"} · {fmtDate(a.createdAt)}</div>
            {a.message ? <div className="mt-1 text-ink-soft">{a.message}</div> : null}
          </div>
          {a.status === "PENDING" && canEdit ? (
            <div className="flex gap-2 shrink-0"><button className={btnPrimary} onClick={() => setApproving(a)}>تأیید</button><button className={btnDanger} onClick={() => reject(a)}>رد</button></div>
          ) : <Badge tone={a.status === "APPROVED" ? "success" : a.status === "REJECTED" ? "danger" : "neutral"}>{a.status === "APPROVED" ? "تأییدشده" : a.status === "REJECTED" ? "ردشده" : "در انتظار"}</Badge>}
        </Card>
      ))}
      {approving ? <ApproveModal app={approving} products={products} onClose={() => setApproving(null)} onDone={() => { setApproving(null); load(); onChanged(); }} /> : null}
    </div>
  );
}

function ApproveModal({ app, products, onClose, onDone }: { app: AgentApplication; products: AgentProduct[]; onClose: () => void; onDone: () => void }) {
  const preset = products.find((p) => p.code === app.productCode);
  const [picked, setPicked] = useState<Record<string, AgentLevel | undefined>>(preset ? { [preset.id]: "B" } : {});
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [result, setResult] = useState<string | null>(null);
  async function go() {
    setBusy(true); setErr(null);
    try {
      const r = await agentsApproveApplication(app.id, pickedList(picked) as never);
      setResult(r.accessGranted ? "تأیید شد و پیامک ورود ارسال شد." : `تأیید شد؛ اعطای ورود ناموفق: ${r.accessError ?? ""}`);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title={`تأیید ${app.name}`} onClose={result ? onDone : onClose}>
      {result ? <div className="flex flex-col gap-3"><div className="text-[13px]">{result}</div><button className={btnPrimary} onClick={onDone}>بستن</button></div> : (
        <div className="flex flex-col gap-3.5">
          <div className="text-[12.5px] text-ink-soft">محصولاتی را که این نماینده در آن‌ها فعال می‌شود و سطح او را انتخاب کنید. پروفایل، عضویت و ورود با همین شماره ساخته می‌شود.</div>
          <MembershipPicker products={products} value={picked} onChange={setPicked} />
          {err ? <div className="text-[12px] text-danger">{err}</div> : null}
          <div className="flex justify-end gap-2"><button className={btnGhost} onClick={onClose}>انصراف</button><button className={btnPrimary} disabled={busy || pickedList(picked).length === 0} onClick={go}>{busy ? "..." : "تأیید و ساخت نماینده"}</button></div>
        </div>
      )}
    </Modal>
  );
}

// ── جزئیات نماینده با تب هر محصول ──
function AgentDetailModal({ id, products, canEdit, onClose, onChanged }: { id: string; products: AgentProduct[]; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const [p, setP] = useState<AgentProfile | null>(null);
  const [tab, setTab] = useState<string>("profile");
  const load = useCallback(() => { agentsGetProfile(id).then(setP).catch(() => undefined); onChanged(); }, [id, onChanged]);
  useEffect(() => { agentsGetProfile(id).then(setP).catch(() => undefined); }, [id]);
  if (!p) return <Modal title="نماینده" onClose={onClose}><Loading rows={null} /></Modal>;
  const tabs = [{ id: "profile", label: "پروفایل" }, ...p.memberships.map((m) => ({ id: m.id, label: m.product.name }))];
  const m = p.memberships.find((x) => x.id === tab);
  const free = products.filter((pr) => pr.isActive && !p.memberships.some((m2) => m2.productId === pr.id));
  return (
    <Modal title={p.contact.name} onClose={onClose} width="max-w-[760px]">
      <div className="flex flex-col gap-4">
        <TabBar value={tab} onChange={setTab} tabs={tabs} />
        {tab === "profile" ? <ProfileEditor p={p} canEdit={canEdit} onChanged={load} free={free} /> : null}
        {m ? <MembershipEditor key={m.id} m={m} profileId={p.id} canEdit={canEdit} onChanged={load} /> : null}
      </div>
    </Modal>
  );
}

function ProfileEditor({ p, canEdit, onChanged, free }: { p: AgentProfile; canEdit: boolean; onChanged: () => void; free: AgentProduct[] }) {
  const [name, setName] = useState(p.contact.name); const [company, setCompany] = useState(p.contact.company ?? ""); const [city, setCity] = useState(p.city ?? ""); const [bio, setBio] = useState(p.bio ?? "");
  const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [change, setChange] = useState<"SHEBA" | "PHONE" | null>(null);
  const [addProduct, setAddProduct] = useState(""); const [addLevel, setAddLevel] = useState<AgentLevel>("B");
  async function save(extra: Parameters<typeof agentsUpdateProfile>[1] = {}) {
    setBusy(true); setMsg(null);
    try { await agentsUpdateProfile(p.id, { name: name.trim(), company: company.trim(), city: city.trim(), bio: bio.trim(), ...extra }); setMsg("ذخیره شد"); onChanged(); } catch (e) { setMsg(errMsg(e)); } finally { setBusy(false); }
  }
  async function photo(file?: File) { if (!file) return; try { await save({ logoUrl: await fileToDataUri(file, "image", AVATAR_IMAGE) }); } catch (e) { setMsg(uploadErrorMessage(e)); } }
  const req = (k: "SHEBA" | "PHONE", v: string) => agentsRequestChange(p.id, k, v);
  const conf = (cid: string, code: string) => agentsConfirmChange(p.id, cid, code);
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center gap-3">
        <div className="w-16 h-16 rounded-full bg-slate-100 overflow-hidden flex items-center justify-center font-extrabold text-primary">{p.logoUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={p.logoUrl} alt="" className="w-full h-full object-cover" /> : p.contact.name.slice(0, 1)}</div>
        {canEdit ? <input type="file" accept="image/*" className="text-[12px]" onChange={(e) => void photo(e.target.files?.[0])} /> : null}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="نام"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} /></Field>
        <Field label="مجموعه"><input className={inputClass} value={company} onChange={(e) => setCompany(e.target.value)} disabled={!canEdit} /></Field>
        <Field label="شهر"><input className={inputClass} value={city} onChange={(e) => setCity(e.target.value)} disabled={!canEdit} /></Field>
        <Field label="احراز"><label className="flex items-center gap-2 min-h-[40px] text-[13px]"><input type="checkbox" className="w-4 h-4" checked={p.isVerified} disabled={!canEdit} onChange={(e) => void save({ isVerified: e.target.checked })} />تیک آبی</label></Field>
      </div>
      <Field label="معرفی کوتاه"><textarea className={inputClass} rows={2} value={bio} onChange={(e) => setBio(e.target.value)} disabled={!canEdit} /></Field>
      {canEdit ? <div className="flex items-center gap-3"><button className={btnPrimary} disabled={busy} onClick={() => save()}>ذخیره</button>{msg ? <span className="text-[12px] text-ink-soft">{msg}</span> : null}</div> : null}
      <hr className="border-border" />
      <div className="text-[13px]">موبایل: <b dir="ltr">{p.contact.phone}</b> {p.phoneVerifiedAt ? <Badge tone="success">تأییدشده</Badge> : null} {canEdit ? <button className="text-primary text-[12px] font-bold ms-2 cursor-pointer" onClick={() => setChange(change === "PHONE" ? null : "PHONE")}>تغییر با کد پیامکی</button> : null}</div>
      {change === "PHONE" ? <SensitiveChange kind="PHONE" request={req} confirm={conf} onDone={() => { setChange(null); onChanged(); }} /> : null}
      <div className="text-[13px]">شبا: <b dir="ltr">{p.shabaMasked ?? "ثبت نشده"}</b> {p.shebaVerifiedAt ? <Badge tone="success">تأییدشده</Badge> : null} {canEdit ? <button className="text-primary text-[12px] font-bold ms-2 cursor-pointer" onClick={() => setChange(change === "SHEBA" ? null : "SHEBA")}>{p.hasSheba ? "تغییر با کد پیامکی" : "ثبت با کد پیامکی"}</button> : null}</div>
      {p.pendingSheba ? <div className="text-[12px] text-warning">شبای جدید {p.pendingSheba.shabaMasked} از طرف نماینده منتظر تأیید است (تب «تأیید شبا»).</div> : null}
      {change === "SHEBA" ? <SensitiveChange kind="SHEBA" request={req} confirm={conf} onDone={() => { setChange(null); onChanged(); }} /> : null}
      {canEdit && free.length ? (
        <>
          <hr className="border-border" />
          <div className="flex gap-2 flex-wrap items-end">
            <Field label="افزودن به محصول"><select className={inputClass} value={addProduct} onChange={(e) => setAddProduct(e.target.value)}><option value="">انتخاب…</option>{free.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
            <Field label="سطح"><select className={inputClass} value={addLevel} onChange={(e) => setAddLevel(e.target.value as AgentLevel)}>{LEVELS.map((l) => <option key={l} value={l}>{AGENT_LEVEL_LABELS[l]}</option>)}</select></Field>
            <button className={btnPrimary} disabled={!addProduct} onClick={async () => { try { await agentsAddMembership(p.id, { productId: addProduct, level: addLevel }); setAddProduct(""); onChanged(); } catch (e) { setMsg(errMsg(e)); } }}>افزودن</button>
          </div>
        </>
      ) : null}
      {p.audit?.length ? (
        <details className="text-[12px] text-muted"><summary className="cursor-pointer">تاریخچه‌ی تغییرات ({fa(p.audit.length)})</summary>
          <ul className="mt-2 flex flex-col gap-1">{p.audit.map((a) => <li key={a.id}>{fmtDate(a.createdAt)} · {a.action}{a.detail ? ` · ${a.detail}` : ""} ({a.actorType})</li>)}</ul>
        </details>
      ) : null}
    </div>
  );
}

function MembershipEditor({ m, profileId, canEdit, onChanged }: { m: AgentMembership; profileId: string; canEdit: boolean; onChanged: () => void }) {
  const [level, setLevel] = useState<AgentLevel>(m.level); const [status, setStatus] = useState<AgentMembershipStatus>(m.status);
  const [code, setCode] = useState(m.referralCode ?? ""); const [note, setNote] = useState(m.note ?? "");
  const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [customers, setCustomers] = useState<AgentCustomer[] | null>(null); const [funnelTotal, setFunnelTotal] = useState<number | null>(null);
  useEffect(() => { agentsAdminCustomers({ membershipId: m.id }).then((r) => setCustomers(r.items)).catch(() => setCustomers([])); agentsAdminFunnel({ profileId }).then((f) => setFunnelTotal(f.total)).catch(() => undefined); }, [m.id, profileId]);
  async function save() {
    setBusy(true); setMsg(null);
    try {
      const patch: Parameters<typeof agentsUpdateMembership>[1] = { level, status, referralCode: code.trim(), note };
      if (status === "ENDED" && m.status !== "ENDED") patch.endReason = window.prompt("دلیل پایان همکاری در این محصول") ?? "پایان همکاری";
      await agentsUpdateMembership(m.id, patch); setMsg("ذخیره شد"); onChanged();
    } catch (e) { setMsg(errMsg(e)); } finally { setBusy(false); }
  }
  const walletPage = useCallback((cursor?: string) => agentsMembershipWallet(m.id, cursor), [m.id]);
  const cardFetch = useCallback(() => agentsMembershipCard(m.id), [m.id]);
  const [walletKey, setWalletKey] = useState(0);
  const [transferOf, setTransferOf] = useState<AgentCustomer | null>(null);
  async function stage(c: AgentCustomer, s: AgentFunnelStage) { try { await agentsChangeStage(c.id, s); setCustomers((prev) => prev?.map((x) => (x.id === c.id ? { ...x, funnelStage: s } : x)) ?? null); } catch (e) { setMsg(errMsg(e)); } }
  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="سطح"><select className={inputClass} value={level} onChange={(e) => setLevel(e.target.value as AgentLevel)} disabled={!canEdit}>{LEVELS.map((l) => <option key={l} value={l}>{AGENT_LEVEL_LABELS[l]}</option>)}</select></Field>
        <Field label="وضعیت"><select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as AgentMembershipStatus)} disabled={!canEdit || m.status === "ENDED"}>{(Object.keys(AGENT_STATUS_LABELS) as AgentMembershipStatus[]).map((s) => <option key={s} value={s}>{AGENT_STATUS_LABELS[s]}</option>)}</select></Field>
        <Field label="کد معرف (دستی، یکتا در محصول)"><input className={`${inputClass} font-mono`} dir="ltr" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} disabled={!canEdit} placeholder="ALI-01" /></Field>
      </div>
      <Field label="یادداشت"><input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} disabled={!canEdit} /></Field>
      <div className="text-[12.5px] text-ink-soft grid sm:grid-cols-2 gap-1">
        <div>پورسانت: طبق «قوانین پورسانت» محصول برای {AGENT_LEVEL_LABELS[m.level]}</div>
        <div>تفاهم‌نامه: {m.agreement.status === "ACCEPTED" ? <Badge tone="success">پذیرفته (نسخه {fa(m.agreement.acceptedVersion ?? 0)})</Badge> : m.agreement.status === "NONE" ? <Badge>بدون تفاهم‌نامه</Badge> : <Badge tone="warning">{m.agreement.status === "REACCEPT_REQUIRED" ? "نیازمند پذیرش مجدد" : "امضا نشده"}</Badge>}</div>
        <div>فروش خالص: <b>{fmtMoney(m.stats.totalSales)}</b></div>
        <div>مشتریان کل نماینده: {funnelTotal === null ? "…" : fa(funnelTotal)}</div>
      </div>
      {canEdit ? <div className="flex items-center gap-3"><button className={btnPrimary} disabled={busy} onClick={save}>ذخیره‌ی عضویت</button>{msg ? <span className="text-[12px] text-ink-soft">{msg}</span> : null}</div> : null}
      <hr className="border-border" />
      <div className="flex items-center justify-between gap-2"><div className="text-[13px] font-bold">کیف پول این محصول</div>{canEdit ? <AdminRequestPayoutButton membershipId={m.id} onDone={() => setWalletKey((k) => k + 1)} /> : null}</div>
      <WalletView key={walletKey} fetchPage={walletPage} minSettlement={m.product.minSettlementAmount} />
      <details className="text-[12.5px]"><summary className="cursor-pointer font-bold">کارت ویزیت نماینده</summary><div className="mt-2"><BusinessCardView fetchCard={cardFetch} /></div></details>
      <hr className="border-border" />
      <div className="text-[13px] font-bold">مشتریان این محصول</div>
      {!customers?.length ? <Loading rows={customers} /> : (
        <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto">
          {customers.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 text-[12.5px] border border-border rounded-xl p-2.5">
              <div className="min-w-0"><div className="font-bold truncate">{c.name}</div><div className="text-muted text-[11.5px]" dir="ltr">{c.phone ?? "—"}</div></div>
              <div className="flex items-center gap-2">
                {canEdit ? <select className={`${inputClass} !w-[130px]`} value={c.funnelStage} onChange={(e) => void stage(c, e.target.value as AgentFunnelStage)}>{AGENT_STAGES.map((s) => <option key={s} value={s}>{AGENT_STAGE_LABELS[s]}</option>)}</select> : <StageBadge stage={c.funnelStage} />}
                {canEdit ? <button className={`${btnGhost} !min-h-[36px] !px-3`} onClick={() => setTransferOf(c)}>انتقال</button> : null}
              </div>
            </div>
          ))}
        </div>
      )}
      {transferOf ? (
        <TransferCustomerModal
          customer={transferOf}
          productId={m.productId}
          fromMembershipId={m.id}
          onClose={() => setTransferOf(null)}
          onDone={() => { setTransferOf(null); setCustomers((prev) => prev?.filter((x) => x.id !== transferOf.id) ?? null); }}
        />
      ) : null}
    </div>
  );
}

/** انتقال مشتری به نماینده‌ی فعال دیگرِ همین محصول — پورسانت تراکنش‌های بعدی به نماینده‌ی جدید می‌رسد. */
function TransferCustomerModal({ customer, productId, fromMembershipId, onClose, onDone }: { customer: AgentCustomer; productId: string; fromMembershipId: string; onClose: () => void; onDone: () => void }) {
  const [options, setOptions] = useState<Array<{ id: string; name: string; level: AgentLevel }> | null>(null);
  const [to, setTo] = useState(""); const [reason, setReason] = useState(""); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => {
    agentsListProfiles({ productId, status: "ACTIVE" })
      .then((ps) => setOptions(ps.flatMap((p) => p.memberships.filter((x) => x.productId === productId && x.status === "ACTIVE" && x.id !== fromMembershipId).map((x) => ({ id: x.id, name: p.contact.name, level: x.level })))))
      .catch((e) => { setErr(errMsg(e)); setOptions([]); });
  }, [productId, fromMembershipId]);
  async function submit() {
    setBusy(true); setErr(null);
    try { await agentsTransferCustomer(customer.id, { toMembershipId: to, reason: reason.trim() || undefined }); onDone(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title={`انتقال مشتری «${customer.name}»`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="text-[12.5px] text-ink-soft leading-6">از این لحظه پورسانت خریدها و تمدیدهای بعدی این مشتری به نماینده‌ی جدید می‌رسد. پورسانت‌های گذشته در کیف پول نماینده‌ی فعلی می‌ماند.</div>
        {options === null ? <Loading rows={null} /> : !options.length ? <div className="text-[12.5px] text-muted">نماینده‌ی فعال دیگری در این محصول نیست.</div> : (
          <Field label="نماینده‌ی جدید"><select className={inputClass} value={to} onChange={(e) => setTo(e.target.value)}><option value="">انتخاب…</option>{options.map((o) => <option key={o.id} value={o.id}>{o.name} — {AGENT_LEVEL_LABELS[o.level]}</option>)}</select></Field>
        )}
        <Field label="دلیل (اختیاری)"><input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
        {err ? <div className="text-[12px] text-danger">{err}</div> : null}
        <button className={btnPrimary} disabled={!to || busy} onClick={submit}>{busy ? "در حال انتقال..." : "انتقال"}</button>
      </div>
    </Modal>
  );
}
