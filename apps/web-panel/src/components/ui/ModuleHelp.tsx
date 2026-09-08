"use client";

import { useState } from "react";
import { Modal } from "./Modal";
import { HelpIcon } from "@/components/icons";
import { MODULE_HELP_CONTENT } from "@/lib/module-help-content";

/**
 * دکمه‌ی راهنمای استاندارد بالای صفحه‌ی اصلی هر ماژول — یک الگوی یکسان در
 * کل برنامه، محتوایش از یک رجیستری مرکزی (module-help-content.ts) خوانده
 * می‌شود تا افزودن راهنما به صفحه‌ی جدید فقط به یک خط same-shape نیاز داشته
 * باشد، نه بازسازی مودال هر بار.
 */
export function ModuleHelp({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const content = MODULE_HELP_CONTENT[code];
  if (!content) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:bg-primary-soft hover:text-primary transition-colors cursor-pointer shrink-0"
        aria-label="راهنمای این بخش"
        title="راهنما"
      >
        <HelpIcon className="w-4.5 h-4.5" />
      </button>

      {open ? (
        <Modal title={`راهنمای ${content.title}`} onClose={() => setOpen(false)} width="max-w-[440px]">
          <div className="flex flex-col gap-4">
            <p className="text-[13px] text-ink-soft leading-relaxed">{content.intro}</p>
            <div className="bg-primary-soft rounded-xl p-4">
              <div className="text-[12.5px] font-extrabold text-primary mb-2.5">{content.scenario}</div>
              <ol className="flex flex-col gap-2">
                {content.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-primary text-white text-[10.5px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <span className="text-[12.5px] text-ink-soft leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
