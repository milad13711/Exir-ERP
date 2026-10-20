"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";

export type ComboUser = { id: string; name: string; phone?: string | null; hint?: string };

/**
 * انتخابگر کاربر با جستجو (ARIA combobox): ↑/↓ برای حرکت، Enter برای انتخاب، Esc برای بستن.
 * ورودی ۱۶px (بدون زوم iOS) و ردیف‌های ≥۴۴px برای لمس.
 */
export function UserCombobox({
  label,
  users,
  value,
  onChange,
  placeholder = "جستجوی نام یا شماره…",
  suggestedIds = [],
  suggestionLabels = {},
  disabled = false,
}: {
  label: string;
  users: ComboUser[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  suggestedIds?: string[];
  suggestionLabels?: Record<string, string>;
  disabled?: boolean;
}) {
  const uid = useId();
  const listId = `${uid}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const selected = users.find((u) => u.id === value) ?? null;

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = users.filter((u) => !q || u.name.toLowerCase().includes(q) || (u.phone ?? "").includes(q));
    // پیشنهادها (مدیر مستقیم و …) بالای فهرست، به همان ترتیب پیشنهاد
    const rank = (id: string) => {
      const i = suggestedIds.indexOf(id);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return [...filtered].sort((a, b) => rank(a.id) - rank(b.id));
  }, [users, query, suggestedIds]);

  function choose(id: string) {
    onChange(id);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && open && options[active]) {
      e.preventDefault();
      choose(options[active].id);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation(); // مودال والد بسته نشود
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <label htmlFor={`${uid}-input`} className="block text-[13px] font-semibold mb-1.5">
        {label}
      </label>
      {selected && !open ? (
        <div className="flex items-center justify-between gap-2 border border-border rounded-[10px] px-3 min-h-11 bg-white">
          <span className="text-base font-bold truncate">{selected.name}</span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onChange("");
              setOpen(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
            className="text-[13px] font-bold text-primary min-h-11 px-3 cursor-pointer"
          >
            تغییر
          </button>
        </div>
      ) : (
        <input
          ref={inputRef}
          id={`${uid}-input`}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${uid}-opt-${options[active].id}` : undefined}
          disabled={disabled}
          value={query}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          className="w-full px-3 min-h-11 rounded-[10px] border border-border text-base outline-none focus:border-primary bg-white"
        />
      )}
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto bg-surface border border-border rounded-xl shadow-lg"
        >
          {options.length === 0 ? (
            <li className="px-3 py-3 text-[13px] text-muted">کاربری یافت نشد</li>
          ) : (
            options.map((u, i) => (
              <li
                key={u.id}
                id={`${uid}-opt-${u.id}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(u.id);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex items-center justify-between gap-2 px-3 min-h-11 cursor-pointer ${i === active ? "bg-primary-soft" : ""}`}
              >
                <span className="text-[14px] font-semibold truncate">{u.name}</span>
                {suggestionLabels[u.id] ? <Badge tone="accent">{suggestionLabels[u.id]}</Badge> : u.hint ? <span className="text-[11.5px] text-muted">{u.hint}</span> : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
