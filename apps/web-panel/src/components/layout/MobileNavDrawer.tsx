"use client";

import clsx from "clsx";
import { CloseIcon } from "@/components/icons";
import { SidebarContent } from "./Sidebar";

export function MobileNavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      <div
        className={clsx(
          "fixed inset-0 bg-slate-900/40 z-40 lg:hidden transition-opacity",
          open ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        onClick={onClose}
      />
      <div
        className={clsx(
          "fixed inset-y-0 start-0 z-50 w-[260px] bg-surface lg:hidden transition-transform duration-200 shadow-2xl",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3.5 end-3.5 w-8 h-8 flex items-center justify-center rounded-lg text-ink-soft"
          aria-label="بستن منو"
        >
          <CloseIcon className="w-[18px] h-[18px]" />
        </button>
        <SidebarContent onNavigate={onClose} />
      </div>
    </>
  );
}
