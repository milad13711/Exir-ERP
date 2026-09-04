"use client";

import { useEffect, useState } from "react";
import { getVoipSocket } from "@/lib/voip-socket";
import { useWorkspace } from "@/lib/workspace-context";
import { addCrmContactActivity, createTask, type CrmContact } from "@/lib/api";
import { PhoneIcon } from "@/components/icons";
import { NewContactModal } from "@/components/crm/NewContactModal";

type IncomingCall = { fromNumber: string; contactId: string | null; contactName: string | null; callId: string };

export function IncomingCallPopup() {
  const { installedModules } = useWorkspace();
  const [call, setCall] = useState<IncomingCall | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newContactOpen, setNewContactOpen] = useState(false);

  useEffect(() => {
    if (!installedModules.has("voip")) return;
    const socket = getVoipSocket();
    if (!socket) return;

    function onIncomingCall(payload: IncomingCall) {
      setCall(payload);
      setNote("");
      setSaved(false);
    }
    socket.on("call.incoming", onIncomingCall);
    return () => {
      socket.off("call.incoming", onIncomingCall);
    };
  }, [installedModules]);

  if (!call) return null;

  async function handleSaveNote() {
    if (!call?.contactId || !note.trim()) return;
    setSaving(true);
    try {
      await addCrmContactActivity(call.contactId, "CALL", note.trim());
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateTask() {
    if (!call) return;
    setSaving(true);
    try {
      await createTask({
        title: `پیگیری تماس از ${call.contactName ?? call.fromNumber}`,
        relatedModule: call.contactId ? "crm" : undefined,
        relatedEntityId: call.contactId ?? undefined,
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="fixed bottom-5 left-5 z-50 w-[320px] bg-surface border border-border rounded-2xl shadow-lg p-4 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
            <PhoneIcon className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-bold truncate">{call.contactName ?? "تماس‌گیرنده ناشناس"}</div>
            <div className="text-[12px] text-muted" dir="ltr">
              {call.fromNumber}
            </div>
          </div>
          <button onClick={() => setCall(null)} className="text-muted text-[16px] leading-none cursor-pointer shrink-0">
            ×
          </button>
        </div>

        {!call.contactId ? (
          <button
            onClick={() => setNewContactOpen(true)}
            className="text-[12px] font-bold text-primary bg-primary-soft px-3 py-2 rounded-lg cursor-pointer"
          >
            ذخیره به‌عنوان مخاطب جدید
          </button>
        ) : (
          <>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="یادداشت تماس..."
              rows={2}
              className="text-[12.5px] bg-slate-50 border border-border rounded-lg px-3 py-2 outline-none resize-none"
            />
            <div className="flex items-center gap-2">
              <button
                disabled={saving || !note.trim()}
                onClick={handleSaveNote}
                className="flex-1 text-[12px] font-bold text-white bg-primary px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50"
              >
                ثبت یادداشت
              </button>
              <button
                disabled={saving}
                onClick={handleCreateTask}
                className="flex-1 text-[12px] font-bold text-ink-soft bg-slate-100 px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50"
              >
                ثبت وظیفه پیگیری
              </button>
            </div>
          </>
        )}
        {saved ? <div className="text-[11.5px] text-success">ثبت شد</div> : null}
      </div>

      {newContactOpen ? (
        <NewContactModal
          initialPhone={call.fromNumber}
          onClose={() => setNewContactOpen(false)}
          onCreated={(contact: CrmContact) => {
            setCall((prev) => (prev ? { ...prev, contactId: contact.id, contactName: contact.name } : prev));
            setNewContactOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
