"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Modal } from "@/components/ui/Modal";
import { messengerApi, type ConversationDetail, type ConversationSummary, type MessengerContact, type MessengerSettings } from "@/lib/messenger-api";
import { Avatar, lastSeenLabel } from "./utils";

function useContacts() {
  const [contacts, setContacts] = useState<MessengerContact[] | null>(null);
  useEffect(() => {
    messengerApi.contacts().then(setContacts).catch(() => setContacts([]));
  }, []);
  return contacts;
}

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : "خطایی رخ داد";
}

export function NewChatDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (conversationId: string) => void }) {
  const contacts = useContacts();
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function open(c: MessengerContact) {
    setError(null);
    try {
      const d = await messengerApi.openDirect(c.id);
      onOpen(d.id);
    } catch (e) {
      setError(errMsg(e));
    }
  }
  const list = (contacts ?? []).filter((c) => c.name.includes(q.trim()));
  return (
    <Modal title="گفتگوی جدید" onClose={onClose}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجوی همکار…" className="w-full rounded-xl border border-border px-3 py-2 text-[13.5px] mb-3 outline-none focus:border-primary" />
      {error ? <div className="text-[12.5px] text-danger mb-2">{error}</div> : null}
      <div className="flex flex-col max-h-[50vh] overflow-y-auto">
        {contacts === null ? <div className="text-muted text-sm p-3">در حال بارگذاری…</div> : null}
        {contacts && list.length === 0 ? <div className="text-muted text-sm p-3">همکاری یافت نشد.</div> : null}
        {list.map((c) => (
          <button key={c.id} type="button" disabled={!c.canMessage} onClick={() => open(c)} className={clsx("flex items-center gap-3 px-2 py-2 rounded-xl text-start", c.canMessage ? "hover:bg-slate-50 cursor-pointer" : "opacity-50 cursor-not-allowed")} title={c.canMessage ? undefined : "سیاست پیام‌رسان اجازه‌ی گفتگو با این کاربر را نمی‌دهد"}>
            <Avatar name={c.name} />
            <div className="min-w-0">
              <div className="text-[14px] font-bold truncate">{c.name}{c.isManager ? <span className="text-[10.5px] text-accent ms-1.5">مدیر</span> : null}</div>
              <div className="text-[11.5px] text-muted truncate">{c.canMessage ? lastSeenLabel(c.online, c.lastSeenAt) || c.roleTitle || "" : "دسترسی محدود"}</div>
            </div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function NewGroupDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (conversationId: string) => void }) {
  const contacts = useContacts();
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  async function create() {
    setBusy(true);
    setError(null);
    try {
      const d = await messengerApi.createGroup(title.trim(), [...picked]);
      onCreated(d.id);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="گروه جدید" onClose={onClose}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="نام گروه" className="w-full rounded-xl border border-border px-3 py-2 text-[13.5px] mb-3 outline-none focus:border-primary" />
      <div className="text-[12px] font-bold text-muted mb-1">اعضا ({picked.size})</div>
      <div className="flex flex-col max-h-[40vh] overflow-y-auto border border-border rounded-xl">
        {(contacts ?? []).map((c) => (
          <label key={c.id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer">
            <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
            <Avatar name={c.name} size={32} />
            <span className="text-[13.5px] font-semibold truncate">{c.name}</span>
          </label>
        ))}
      </div>
      {error ? <div className="text-[12.5px] text-danger mt-2">{error}</div> : null}
      <div className="flex justify-end mt-4">
        <button type="button" disabled={busy || !title.trim() || picked.size === 0} onClick={() => void create()} className="px-5 py-2 rounded-xl bg-primary text-white text-[13px] font-bold disabled:opacity-40 cursor-pointer">ساخت گروه</button>
      </div>
    </Modal>
  );
}

export function ForwardDialog({ conversations, onClose, onForward }: { conversations: ConversationSummary[]; onClose: () => void; onForward: (ids: string[]) => Promise<void> }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      await onForward([...picked]);
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  }
  return (
    <Modal title="فوروارد به…" onClose={onClose}>
      <div className="flex flex-col max-h-[50vh] overflow-y-auto border border-border rounded-xl">
        {conversations.map((c) => (
          <label key={c.id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer">
            <input type="checkbox" checked={picked.has(c.id)} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} />
            <Avatar name={c.title} size={32} tone={c.type === "SAVED" ? "saved" : "primary"} />
            <span className="text-[13.5px] font-semibold truncate">{c.title}</span>
          </label>
        ))}
      </div>
      {error ? <div className="text-[12.5px] text-danger mt-2">{error}</div> : null}
      <div className="flex justify-end mt-4">
        <button type="button" disabled={busy || picked.size === 0} onClick={() => void go()} className="px-5 py-2 rounded-xl bg-primary text-white text-[13px] font-bold disabled:opacity-40 cursor-pointer">فوروارد</button>
      </div>
    </Modal>
  );
}

export function GroupInfoDialog({ detail, myId, onClose, onChanged, onLeft }: { detail: ConversationDetail; myId: string; onClose: () => void; onChanged: (d: ConversationDetail) => void; onLeft: () => void }) {
  const contacts = useContacts();
  const [title, setTitle] = useState(detail.title);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canManage = detail.myRole === "OWNER" || detail.myRole === "ADMIN";
  const memberIds = new Set(detail.members.map((m) => m.userId));

  async function run(fn: () => Promise<ConversationDetail>) {
    setError(null);
    try {
      onChanged(await fn());
    } catch (e) {
      setError(errMsg(e));
    }
  }
  return (
    <Modal title="اطلاعات گروه" onClose={onClose}>
      {canManage ? (
        <div className="flex gap-2 mb-4">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} className="flex-1 rounded-xl border border-border px-3 py-2 text-[13.5px] outline-none focus:border-primary" />
          <button type="button" disabled={!title.trim() || title === detail.title} onClick={() => void run(() => messengerApi.renameGroup(detail.id, title.trim()))} className="px-3 rounded-xl bg-primary text-white text-[12.5px] font-bold disabled:opacity-40 cursor-pointer">تغییر نام</button>
        </div>
      ) : (
        <div className="text-[15px] font-extrabold mb-3">{detail.title}</div>
      )}
      <div className="text-[12px] font-bold text-muted mb-1">اعضا ({detail.members.length})</div>
      <div className="flex flex-col max-h-[32vh] overflow-y-auto">
        {detail.members.map((m) => (
          <div key={m.userId} className="flex items-center gap-2.5 py-1.5">
            <Avatar name={m.name} size={32} />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold truncate">{m.name}{m.userId === myId ? " (شما)" : ""}</div>
              <div className="text-[11px] text-muted">{m.role === "OWNER" ? "مالک گروه" : m.role === "ADMIN" ? "مدیر گروه" : ""}</div>
            </div>
            {detail.myRole === "OWNER" && m.role !== "OWNER" ? (
              <button type="button" onClick={() => void run(() => messengerApi.setRole(detail.id, m.userId, m.role === "ADMIN" ? "MEMBER" : "ADMIN"))} className="text-[11.5px] text-primary font-bold cursor-pointer">{m.role === "ADMIN" ? "عزل مدیر" : "ارتقا به مدیر"}</button>
            ) : null}
            {canManage && m.role !== "OWNER" && m.userId !== myId && !(detail.myRole === "ADMIN" && m.role === "ADMIN") ? (
              <button type="button" onClick={() => void run(() => messengerApi.removeMember(detail.id, m.userId))} className="text-[11.5px] text-danger font-bold cursor-pointer">حذف</button>
            ) : null}
          </div>
        ))}
      </div>
      {canManage ? (
        <div className="mt-3">
          <button type="button" onClick={() => setAdding((v) => !v)} className="text-[12.5px] font-bold text-primary cursor-pointer">＋ افزودن عضو</button>
          {adding ? (
            <div className="mt-2 border border-border rounded-xl max-h-[26vh] overflow-y-auto">
              {(contacts ?? []).filter((c) => !memberIds.has(c.id)).map((c) => (
                <button key={c.id} type="button" onClick={() => void run(() => messengerApi.addMembers(detail.id, [c.id]))} className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 text-start cursor-pointer">
                  <Avatar name={c.name} size={28} /> <span className="text-[13px] font-semibold">{c.name}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? <div className="text-[12.5px] text-danger mt-2">{error}</div> : null}
      <div className="flex justify-end mt-4">
        <button type="button" onClick={async () => { if (window.confirm("از این گروه خارج می‌شوید؟")) { try { await messengerApi.leave(detail.id); onLeft(); } catch (e) { setError(errMsg(e)); } } }} className="px-4 py-2 rounded-xl border border-danger text-danger text-[13px] font-bold cursor-pointer">ترک گروه</button>
      </div>
    </Modal>
  );
}

const POLICY_LABELS: Record<MessengerSettings["policy"], string> = {
  OPEN: "همه می‌توانند با همه گفتگو کنند",
  MANAGERS_AND_SHARED_ROLE: "کاربران فقط با مدیران و هم‌نقش‌های خود گفتگو کنند",
  MANAGERS_INITIATE: "فقط مدیران می‌توانند گفتگوی جدید شروع کنند",
};

export function SettingsDialog({ isManager, onClose }: { isManager: boolean; onClose: () => void }) {
  const [s, setS] = useState<MessengerSettings | null>(null);
  const [hidden, setHidden] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    messengerApi.settings().then(setS).catch(() => undefined);
    messengerApi.presence().then((p) => setHidden(p.hidden)).catch(() => undefined);
  }, []);

  async function save(patch: Partial<MessengerSettings>) {
    try {
      setS(await messengerApi.updateSettings(patch));
      setMsg("ذخیره شد");
    } catch (e) {
      setMsg(errMsg(e));
    }
  }
  return (
    <Modal title="تنظیمات پیام‌رسان" onClose={onClose}>
      <div className="rounded-xl bg-primary-soft text-primary text-[12.5px] font-semibold px-3.5 py-2.5 mb-4 leading-relaxed">
        🔒 مدیران هم نمی‌توانند گفتگوهای خصوصی دیگران را بخوانند؛ هر گفتگو فقط برای اعضای خودش قابل مشاهده است.
      </div>
      <label className="flex items-center gap-2 text-[13.5px] mb-4 cursor-pointer">
        <input type="checkbox" checked={hidden} onChange={async (e) => { setHidden(e.target.checked); await messengerApi.setPresenceHidden(e.target.checked).catch(() => undefined); }} />
        وضعیت آنلاین و آخرین بازدید من برای دیگران نمایش داده نشود
      </label>
      {isManager && s ? (
        <div className="border-t border-border pt-4 flex flex-col gap-4">
          <div>
            <div className="text-[12.5px] font-bold mb-1.5">چه کسانی می‌توانند با چه کسانی گفتگو کنند؟</div>
            {(Object.keys(POLICY_LABELS) as MessengerSettings["policy"][]).map((p) => (
              <label key={p} className="flex items-center gap-2 text-[13px] py-1 cursor-pointer">
                <input type="radio" name="policy" checked={s.policy === p} onChange={() => void save({ policy: p })} /> {POLICY_LABELS[p]}
              </label>
            ))}
          </div>
          <div>
            <div className="text-[12.5px] font-bold mb-1.5">چه کسانی می‌توانند گروه بسازند؟</div>
            {([["EVERYONE", "همه"], ["MANAGERS", "فقط مدیران"]] as const).map(([v, l]) => (
              <label key={v} className="flex items-center gap-2 text-[13px] py-1 cursor-pointer">
                <input type="radio" name="gc" checked={s.groupCreation === v} onChange={() => void save({ groupCreation: v })} /> {l}
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[13px] cursor-pointer">
            <input type="checkbox" checked={s.hidePreview} onChange={(e) => void save({ hidePreview: e.target.checked })} /> متن پیام در اعلان‌های گوشی نمایش داده نشود
          </label>
          <label className="flex items-center gap-2 text-[13px] cursor-pointer">
            <input type="checkbox" checked={s.showPresence} onChange={(e) => void save({ showPresence: e.target.checked })} /> نمایش آنلاین/آخرین بازدید در این مجموعه
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            نگه‌داری متن پیام‌ها:
            <select value={s.retentionDays ?? ""} onChange={(e) => void save({ retentionDays: e.target.value ? Number(e.target.value) : null })} className="border border-border rounded-lg px-2 py-1">
              <option value="">نامحدود</option>
              <option value="30">۳۰ روز</option>
              <option value="90">۹۰ روز</option>
              <option value="180">۱۸۰ روز</option>
              <option value="365">یک سال</option>
            </select>
          </label>
          <div className="text-[11.5px] text-muted">فایل‌ها و تصاویر در هر حال فقط ۲۴ ساعت نگهداری می‌شوند.</div>
        </div>
      ) : null}
      {msg ? <div className="text-[12px] text-muted mt-3">{msg}</div> : null}
    </Modal>
  );
}
