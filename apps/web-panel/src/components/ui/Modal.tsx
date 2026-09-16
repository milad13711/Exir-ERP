import type { ReactNode } from "react";
import { CloseIcon } from "@/components/icons";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div
        className={`bg-surface rounded-2xl border border-border w-full ${width} max-h-[calc(100dvh-2rem)] shadow-xl overflow-hidden flex flex-col`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-[15px] font-extrabold">{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:bg-primary-soft hover:text-primary cursor-pointer"
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
