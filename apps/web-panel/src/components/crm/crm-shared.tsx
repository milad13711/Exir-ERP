import type { Tone } from "@/components/ui/Badge";
import { PhoneIcon, MailIcon, CheckIcon, ArrowUpIcon } from "@/components/icons";
import { formatJalaliDate } from "@/lib/persian";
import type { CrmActivity, CrmActivityType, CrmDealStage } from "@/lib/api";

export const STAGE_ORDER: CrmDealStage[] = [
  "NEW",
  "CONTACTED",
  "PROPOSAL",
  "NEGOTIATION",
  "WON",
  "LOST",
];

export const STAGE_META: Record<CrmDealStage, { label: string; tone: Tone }> = {
  NEW: { label: "جدید", tone: "neutral" },
  CONTACTED: { label: "در تماس", tone: "primary" },
  PROPOSAL: { label: "پیشنهاد قیمت", tone: "accent" },
  NEGOTIATION: { label: "مذاکره", tone: "warning" },
  WON: { label: "برد", tone: "success" },
  LOST: { label: "باخت", tone: "danger" },
};

export const ACTIVITY_TYPE_LABELS: Record<CrmActivityType, string> = {
  NOTE: "یادداشت",
  CALL: "تماس تلفنی",
  MEETING: "جلسه",
  EMAIL: "ایمیل",
  STAGE_CHANGE: "تغییر مرحله",
};

export function ActivityIcon({ type, className }: { type: CrmActivityType; className?: string }) {
  switch (type) {
    case "CALL":
      return <PhoneIcon className={className} />;
    case "EMAIL":
      return <MailIcon className={className} />;
    case "STAGE_CHANGE":
      return <ArrowUpIcon className={className} />;
    default:
      return <CheckIcon className={className} />;
  }
}

export function ActivityTimeline({ activities }: { activities: CrmActivity[] }) {
  if (activities.length === 0) {
    return <div className="text-[12.5px] text-muted text-center py-6">هنوز فعالیتی ثبت نشده است</div>;
  }
  return (
    <div className="flex flex-col gap-3">
      {activities.map((a) => (
        <div key={a.id} className="flex items-start gap-3">
          <div className="w-7 h-7 rounded-lg bg-primary-soft text-primary flex items-center justify-center shrink-0 mt-0.5">
            <ActivityIcon type={a.type} className="w-3.5 h-3.5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[12.5px] font-bold">{ACTIVITY_TYPE_LABELS[a.type]}</span>
              <span className="text-[11px] text-muted">
                {a.user?.name ?? "سیستم"} · {formatJalaliDate(a.createdAt)}
              </span>
            </div>
            {a.body ? <p className="text-[12.5px] text-ink-soft mt-1 leading-6">{a.body}</p> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AddActivityForm({
  onSubmit,
}: {
  onSubmit: (type: CrmActivityType, body: string) => Promise<void>;
}) {
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const type = (form.elements.namedItem("type") as HTMLSelectElement).value as CrmActivityType;
        const body = (form.elements.namedItem("body") as HTMLTextAreaElement).value.trim();
        if (!body) return;
        await onSubmit(type, body);
        form.reset();
      }}
      className="flex flex-col gap-2 border-t border-border pt-4 mt-4"
    >
      <div className="flex items-center gap-2">
        <select
          name="type"
          defaultValue="NOTE"
          className="text-[12px] font-semibold bg-slate-50 border border-border rounded-lg px-2 py-1.5 outline-none"
        >
          <option value="NOTE">یادداشت</option>
          <option value="CALL">تماس تلفنی</option>
          <option value="MEETING">جلسه</option>
          <option value="EMAIL">ایمیل</option>
        </select>
        <span className="text-[11.5px] text-muted">افزودن فعالیت جدید</span>
      </div>
      <div className="flex items-center gap-2">
        <textarea
          name="body"
          rows={2}
          placeholder="توضیحات را بنویسید..."
          className="flex-1 text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3 py-2 resize-none"
        />
        <button
          type="submit"
          className="text-[12.5px] font-bold text-primary shrink-0 cursor-pointer px-2"
        >
          ثبت
        </button>
      </div>
    </form>
  );
}
