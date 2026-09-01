export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h1 className="text-xl font-extrabold">{title}</h1>
      <p className="text-[13.5px] text-muted mt-1">{description}</p>
      <div className="mt-8 border-[1.5px] border-dashed border-border rounded-2xl py-16 flex flex-col items-center gap-2 text-muted">
        <span className="text-sm font-semibold">این بخش به‌زودی تکمیل می‌شود</span>
      </div>
    </div>
  );
}
