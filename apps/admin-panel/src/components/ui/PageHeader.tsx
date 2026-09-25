import type { ReactNode } from "react";

/** عنوان یکدست بالای هر صفحه — عنوان + توضیح کوتاه + دکمه‌ی اصلی صفحه (در موبایل زیر عنوان، تمام‌عرض). */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <h1 className="text-[22px] leading-tight font-extrabold tracking-tight">{title}</h1>
        {subtitle ? <p className="text-[13px] text-muted mt-1.5">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0 max-sm:w-full [&>button]:max-sm:w-full [&>button]:max-sm:justify-center">{action}</div> : null}
    </div>
  );
}
