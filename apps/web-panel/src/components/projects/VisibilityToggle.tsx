import clsx from "clsx";
import { EyeIcon, EyeOffIcon } from "@/components/icons";

/** کلید «نمایش به مشتری»: چشم باز = در لینک عمومی دیده می‌شود، چشم بسته = خصوصی (پیش‌فرض). */
export function VisibilityToggle({
  visible,
  onChange,
  disabled,
  compact = false,
}: {
  visible: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={visible}
      title={visible ? "این مورد به مشتری نمایش داده می‌شود" : "خصوصی — به مشتری نمایش داده نمی‌شود"}
      disabled={disabled}
      onClick={() => onChange(!visible)}
      className={clsx(
        "inline-flex items-center gap-1 rounded-lg font-bold cursor-pointer disabled:opacity-50 shrink-0 transition-colors",
        compact ? "text-[10.5px] px-2 py-1" : "text-[11px] px-2.5 py-1.5",
        visible ? "bg-success-soft text-success" : "bg-slate-100 text-muted",
      )}
    >
      {visible ? <EyeIcon className="w-3.5 h-3.5" /> : <EyeOffIcon className="w-3.5 h-3.5" />}
      {visible ? "نمایش به مشتری" : "خصوصی"}
    </button>
  );
}
