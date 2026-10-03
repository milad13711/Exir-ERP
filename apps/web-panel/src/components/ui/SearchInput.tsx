"use client";

import clsx from "clsx";
import { SearchIcon } from "@/components/icons";

/** Standard list search box. `loading` shows a subtle spinner while a server search is in flight. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  loading = false,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div className={clsx("relative", className)}>
      <SearchIcon className="w-4 h-4 text-muted absolute top-1/2 -translate-y-1/2 right-3.5" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full text-[13px] outline-none placeholder:text-muted bg-surface border border-border rounded-xl pr-10 pl-9 py-2.5 focus:border-primary transition-colors"
      />
      {loading ? (
        <span
          aria-hidden
          className="absolute top-1/2 -translate-y-1/2 left-3 w-3.5 h-3.5 rounded-full border-2 border-border border-t-primary animate-spin"
        />
      ) : null}
    </div>
  );
}
