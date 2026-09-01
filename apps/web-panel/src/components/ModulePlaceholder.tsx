import type { ComponentType, SVGProps } from "react";

export function ModulePlaceholder({
  title,
  description,
  Icon,
}: {
  title: string;
  description: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}) {
  return (
    <div className="p-5 lg:p-7 max-w-[1240px] mx-auto">
      <h1 className="text-xl font-extrabold">{title}</h1>
      <p className="text-[13.5px] text-muted mt-1">{description}</p>
      <div className="mt-8 border-[1.5px] border-dashed border-border rounded-2xl py-20 flex flex-col items-center gap-3 text-muted">
        <Icon className="w-9 h-9" />
        <span className="text-sm font-semibold">این ماژول در فاز بعدی پیاده‌سازی می‌شود</span>
      </div>
    </div>
  );
}
