/** جداکننده‌ی ساده‌ی زیر عنوان بخش‌ها: خط + لوزی مرکزی. */
export function OrnamentDivider({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-3 ${className}`} aria-hidden="true">
      <span className="h-px w-16 bg-gradient-to-l from-primary/50 to-transparent" />
      <span className="w-2 h-2 rotate-45 bg-primary" />
      <span className="h-px w-16 bg-gradient-to-r from-primary/50 to-transparent" />
    </div>
  );
}

/** باند بالای صفحه‌های داخلی — زمینه‌ی سبز ساده با پالت برند و یک خط زردِ باریک پایین. */
export function HeroBand({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`hero-band ${className}`}>{children}</section>;
}
