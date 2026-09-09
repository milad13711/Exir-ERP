"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { fetchEventPosterObjectUrl, type EventItem } from "@/lib/api";

export function EventPosterModal({ event, onClose }: { event: EventItem; onClose: () => void }) {
  const [code, setCode] = useState<"post-square" | "story">("post-square");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let revoke: string | null = null;
    // قالب عوض شده — پوستر قبلی عمداً همین‌جا پاک می‌شود تا لحظه‌ای تصویر قالب اشتباه نمایش داده نشود
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setImageUrl(null);
    setError(null);
    fetchEventPosterObjectUrl(event.id, code)
      .then((url) => {
        revoke = url;
        setImageUrl(url);
      })
      .catch(() => setError("ساخت پوستر ناموفق بود"));
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [event.id, code]);

  return (
    <Modal title="انتشار در شبکه‌های اجتماعی" onClose={onClose} width="max-w-[420px]">
      <div className="flex flex-col items-center gap-4">
        <div className="flex gap-2 w-full">
          <button
            type="button"
            onClick={() => setCode("post-square")}
            className={`flex-1 text-[12.5px] font-bold px-3 py-2.5 rounded-xl cursor-pointer ${code === "post-square" ? "bg-primary text-white" : "bg-slate-100 text-ink-soft"}`}
          >
            پست مربعی
          </button>
          <button
            type="button"
            onClick={() => setCode("story")}
            className={`flex-1 text-[12.5px] font-bold px-3 py-2.5 rounded-xl cursor-pointer ${code === "story" ? "bg-primary text-white" : "bg-slate-100 text-ink-soft"}`}
          >
            استوری
          </button>
        </div>

        {error ? (
          <div className="text-[12.5px] text-danger">{error}</div>
        ) : imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={event.title} className="w-full rounded-xl border border-border" />
        ) : (
          <div className="text-[12.5px] text-muted py-10">در حال ساخت تصویر...</div>
        )}

        {imageUrl && (
          <a href={imageUrl} download={`${event.title}-${code}.png`} className="text-[12.5px] font-bold text-primary">
            دانلود تصویر — برای انتشار در استوری/پست اینستاگرام یا واتس‌اپ ←
          </a>
        )}
      </div>
    </Modal>
  );
}
