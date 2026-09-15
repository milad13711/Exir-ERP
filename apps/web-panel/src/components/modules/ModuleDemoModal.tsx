"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { CheckIcon } from "@/components/icons";
import { activateModuleDemo, ApiError, type ModuleCatalogItem } from "@/lib/api";

export function ModuleDemoModal({
  module: m,
  onClose,
  onActivated,
}: {
  module: ModuleCatalogItem;
  onClose: () => void;
  onActivated: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    setStarting(true);
    setError(null);
    try {
      await activateModuleDemo(m.code);
      onActivated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "شروع نسخه‌ی آزمایشی ناموفق بود");
    } finally {
      setStarting(false);
    }
  }

  return (
    <Modal title={`دموی ماژول «${m.name}»`} onClose={onClose} width="max-w-[520px]">
      <div className="flex flex-col gap-4">
        {m.demoScreenshot1Url || m.demoScreenshot2Url ? (
          <div className="grid grid-cols-2 gap-2.5">
            {[m.demoScreenshot1Url, m.demoScreenshot2Url].filter(Boolean).map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={src!} alt={`نمای محیط ماژول ${m.name}`} className="w-full rounded-xl border border-border object-cover" />
            ))}
          </div>
        ) : (
          <div className="py-6 text-center text-[12.5px] text-muted bg-slate-50 rounded-xl border border-dashed border-border">
            تصویری از این ماژول هنوز ثبت نشده است
          </div>
        )}

        {m.demoDescription ? (
          <p className="text-[13px] text-ink-soft leading-relaxed">{m.demoDescription}</p>
        ) : null}

        {m.demoValueProps.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {m.demoValueProps.map((v) => (
              <li key={v} className="flex items-start gap-1.5 text-[12.5px] text-ink-soft">
                <CheckIcon className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
                <span>{v}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="border-t border-border pt-4">
          {m.demoAvailable ? (
            <>
              <label className="flex items-start gap-2 text-[12px] text-ink-soft leading-relaxed mb-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-0.5 shrink-0"
                />
                <span>
                  می‌دانم نسخه‌ی آزمایشی این ماژول فقط اجازه‌ی ثبت <b>یک رکورد</b> را می‌دهد و پس از آن به‌طور خودکار
                  غیرفعال می‌شود؛ برای استفاده‌ی کامل باید از فروشگاه ماژول خریداری شود.
                </span>
              </label>
              {error ? <div className="text-[12px] text-danger mb-2">{error}</div> : null}
              <button
                onClick={handleStart}
                disabled={!agreed || starting}
                className="w-full py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer disabled:opacity-50"
              >
                {starting ? "در حال فعال‌سازی..." : "شروع نسخه‌ی آزمایشی"}
              </button>
            </>
          ) : (
            <div className="text-center text-[12.5px] text-muted py-1">
              نسخه‌ی آزمایشی این ماژول قبلاً استفاده شده است — برای استفاده‌ی کامل، از فروشگاه ماژول خریداری کنید.
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
