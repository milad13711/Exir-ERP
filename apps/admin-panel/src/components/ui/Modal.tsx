import type { ReactNode } from "react";
import { CloseIcon } from "@/components/icons";

/** روی دسکتاپ یک دیالوگ وسط صفحه؛ روی موبایل یک شیت از پایین با اسکرول داخلی. */
export function Modal({
  title,
  onClose,
  children,
  width = "max-w-[480px]",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/45 backdrop-blur-[2px] sm:p-4 animate-fade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`bg-surface w-full ${width} max-h-[92dvh] sm:max-h-[calc(100dvh-2rem)] rounded-t-3xl sm:rounded-2xl border border-border shadow-2xl flex flex-col animate-sheet pb-safe`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-[15px] font-extrabold">{title}</h2>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl flex items-center justify-center text-muted hover:bg-primary-soft hover:text-primary cursor-pointer"
            aria-label="بستن"
          >
            <CloseIcon className="w-4.5 h-4.5" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
