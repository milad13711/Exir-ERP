"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SearchIcon, PlusIcon } from "@/components/icons";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useRequestGuard } from "@/hooks/useRequestGuard";
import { NewContactModal } from "@/components/crm/NewContactModal";
import { fetchCrmContact, searchCrmContacts, searchSuppliers, type ContactSearchHit } from "@/lib/api";

type Picked = { id: string; name: string; company: string | null; phone: string | null };

const labelOf = (c: { name: string; company: string | null }) => c.company || c.name;

/**
 * انتخاب‌گر مشتری/تأمین‌کننده با جستجوی سرور (debounce)، قابل‌استفاده با کیبورد (↑ ↓ Enter Esc) و مناسب موبایل.
 * جستجو روی نام، شرکت، موبایل، کد ملی/اقتصادی/شناسه‌ی ملی و ایمیل است؛ نتیجه محدود و تابع دامنه‌ی مشاهده‌ی کاربر است.
 * `allowCreate` گزینه‌ی «ایجاد مشتری جدید» را با همان فرم مخاطب جدید باز می‌کند.
 */
export function ContactCombobox({
  value,
  onChange,
  source = "customer",
  initialLabel,
  knownLabel,
  allowCreate = source === "customer",
  placeholder = "جستجوی مشتری (نام، شرکت، موبایل، کد ملی)...",
  autoFocus = false,
}: {
  value: string;
  onChange: (id: string, contact: Picked | null) => void;
  source?: "customer" | "supplier";
  /** برنچسب اولیه (مثلاً هنگام ویرایش) تا برای نمایش نام، درخواست اضافه لازم نباشد. */
  initialLabel?: string;
  /** نام مخاطبی که همین الان در همان فرم ساخته شده — برای نمایش بدون درخواست دوباره (و مستقل از دسترسی CRM). */
  knownLabel?: { id: string; label: string };
  allowCreate?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const listId = useId();
  const [selected, setSelected] = useState<Picked | null>(value && initialLabel ? { id: value, name: initialLabel, company: null, phone: null } : null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<ContactSearchHit[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const debounced = useDebouncedValue(query, 300);
  const begin = useRequestGuard();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // نمایشِ مخاطب انتخاب‌شده: از انتخاب خود کاربر، یا برچسب شناخته‌شده (همین فرم ساخته)، وگرنه یک‌بار از سرور می‌گیریم.
  const fromKnown: Picked | null = value && knownLabel && knownLabel.id === value ? { id: value, name: knownLabel.label, company: null, phone: null } : null;
  const shown: Picked | null = value ? (selected?.id === value ? selected : fromKnown) : null;
  const needsFetch = !!value && !shown;
  useEffect(() => {
    if (!needsFetch) return;
    let alive = true;
    fetchCrmContact(value)
      .then((c) => {
        if (alive) setSelected({ id: c.id, name: c.name, company: c.company, phone: c.phone });
      })
      .catch(() => {
        if (alive) setSelected({ id: value, name: source === "supplier" ? "تأمین‌کننده‌ی انتخاب‌شده" : "مشتری انتخاب‌شده", company: null, phone: null });
      });
    return () => {
      alive = false;
    };
  }, [needsFetch, value, source]);

  // جستجو فقط وقتی لیست باز است.
  useEffect(() => {
    if (!open) return;
    const isCurrent = begin();
    const term = debounced.trim();
    const run = source === "supplier" ? searchSuppliers(term, 15) : searchCrmContacts(term, { limit: 15, kind: "all" });
    run
      .then((r) => {
        if (!isCurrent()) return;
        setResults(r);
        setFailed(false);
        setActive(0);
      })
      .catch(() => {
        if (isCurrent()) {
          setResults([]);
          setFailed(true);
        }
      })
      .finally(() => {
        if (isCurrent()) setLoadedFor(term);
      });
  }, [debounced, open, source, begin]);

  // بستن با کلیک بیرون
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent | TouchEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  function pick(c: ContactSearchHit) {
    const picked = { id: c.id, name: c.name, company: c.company, phone: c.phone };
    setSelected(picked);
    setQuery("");
    setOpen(false);
    onChange(c.id, picked);
  }

  function clear() {
    setSelected(null);
    onChange("", null);
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  const searching = open && (loadedFor === null || loadedFor !== query.trim());
  const optionCount = results.length + (allowCreate ? 1 : 0);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((a) => (optionCount ? (a + 1) % optionCount : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (optionCount ? (a - 1 + optionCount) % optionCount : 0));
    } else if (e.key === "Enter") {
      if (!open) return;
      e.preventDefault(); // فرم والد با Enter ثبت نشود
      if (active < results.length) pick(results[active]);
      else if (allowCreate) setCreateOpen(true);
    } else if (e.key === "Escape") {
      if (open) {
        e.stopPropagation();
        setOpen(false);
      }
    } else if (e.key === "Home" && open) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && open) {
      e.preventDefault();
      setActive(Math.max(optionCount - 1, 0));
    }
  }

  if (shown && value) {
    return (
      <div className="flex items-center justify-between gap-2 bg-primary-soft rounded-xl px-3.5 py-2.5">
        <div className="min-w-0">
          <div className="text-[13px] font-bold truncate">{labelOf(shown)}</div>
          {shown.company && shown.name ? <div className="text-[11.5px] text-ink-soft truncate">{shown.name}</div> : null}
          {shown.phone ? (
            <div className="text-[11px] text-muted" dir="ltr">
              {shown.phone}
            </div>
          ) : null}
        </div>
        <button type="button" onClick={clear} className="text-[12px] font-bold text-primary cursor-pointer shrink-0 px-2 py-1.5">
          تغییر
        </button>
      </div>
    );
  }

  if (value && !shown) {
    return <div className="bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 text-[12.5px] text-muted">در حال بارگذاری مشخصات...</div>;
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <SearchIcon className="w-4 h-4 text-muted absolute top-1/2 -translate-y-1/2 right-3.5 pointer-events-none" />
        <input
          ref={inputRef}
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active < results.length ? `${listId}-${active}` : undefined}
          autoComplete="off"
          inputMode="search"
          enterKeyHint="search"
          className="w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl pr-10 pl-9 py-2.5 focus:border-primary transition-colors"
        />
        {searching ? (
          <span aria-hidden className="absolute top-1/2 -translate-y-1/2 left-3 w-3.5 h-3.5 rounded-full border-2 border-border border-t-primary animate-spin" />
        ) : null}
      </div>
      {open ? (
        <div
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 w-full bg-surface border border-border rounded-xl shadow-lg overflow-y-auto max-h-[min(50vh,280px)] overscroll-contain"
        >
          {results.length === 0 && !searching ? (
            <div className="text-[12px] text-muted text-center py-3 px-3">
              {failed ? "جستجو ناموفق بود؛ دوباره تلاش کنید" : loadedFor === null ? "در حال بارگذاری..." : "نتیجه‌ای یافت نشد"}
            </div>
          ) : null}
          {results.map((c, i) => (
            <button
              key={c.id}
              id={`${listId}-${i}`}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(c)}
              className={`w-full text-right px-3.5 py-2.5 min-h-[44px] border-b border-border last:border-b-0 cursor-pointer ${i === active ? "bg-primary-soft" : "hover:bg-primary-soft"}`}
            >
              <div className="text-[12.5px] font-semibold">{labelOf(c)}</div>
              <div className="text-[11px] text-muted flex gap-2 flex-wrap">
                {c.company ? <span>{c.name}</span> : null}
                <span dir="ltr">{c.phone ?? "بدون شماره"}</span>
                {c.nationalId ? <span dir="ltr">{c.nationalId}</span> : null}
              </div>
            </button>
          ))}
          {allowCreate ? (
            <button
              type="button"
              role="option"
              aria-selected={active === results.length}
              id={`${listId}-${results.length}`}
              onMouseEnter={() => setActive(results.length)}
              onClick={() => setCreateOpen(true)}
              className={`w-full text-right px-3.5 py-2.5 min-h-[44px] flex items-center gap-1.5 text-[12.5px] font-bold text-primary cursor-pointer ${active === results.length ? "bg-primary-soft" : "hover:bg-primary-soft"}`}
            >
              <PlusIcon className="w-3.5 h-3.5" />
              ایجاد مشتری جدید{query.trim() ? ` «${query.trim()}»` : ""}
            </button>
          ) : null}
        </div>
      ) : null}
      {createOpen && typeof document !== "undefined"
        ? createPortal(
            // Portal: فرم «مخاطب جدید» داخل <form> فاکتور تو در تو نشود. رویداد submit در درخت React هنوز به والد می‌رسد،
            // پس اینجا متوقف می‌شود تا ثبت مشتری، فاکتور را ثبت نکند.
            <div onSubmit={(e) => e.stopPropagation()}>
              <NewContactModal
                onClose={() => setCreateOpen(false)}
                initialPhone={/^[\d۰-۹+\s-]{7,}$/.test(query.trim()) ? query.trim() : undefined}
                onCreated={(c) => {
                  setCreateOpen(false);
                  pick({ id: c.id, type: c.type, name: c.name, company: c.company, phone: c.phone, nationalId: c.nationalId, isCustomer: c.isCustomer, isSupplier: c.isSupplier });
                }}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
