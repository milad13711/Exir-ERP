"use client";

const GROUPS: { label: string; items: string[] }[] = [
  { label: "پرکاربرد", items: ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "👏", "🎉", "👎", "✅", "❌"] },
  { label: "چهره‌ها", items: ["😀", "😁", "😅", "🤣", "😊", "😍", "😘", "😎", "🤔", "😴", "😡", "🥳", "😭", "🙄", "🤝", "😇", "🤗", "😬", "🥲", "😏"] },
  { label: "نمادها", items: ["💪", "👌", "✌️", "🙌", "👀", "💡", "⭐", "💯", "📌", "📎", "⏰", "📞", "💰", "🎯", "🚀", "☕", "🌹", "🎁", "📈", "✨"] },
];

/** انتخاب‌گر ساده‌ی ایموجی (بدون وابستگی). */
export function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  return (
    <div className="bg-surface border border-border rounded-2xl shadow-xl p-3 w-[300px] max-w-[90vw] max-h-[320px] overflow-y-auto" role="dialog" aria-label="انتخاب ایموجی">
      {GROUPS.map((g) => (
        <div key={g.label} className="mb-2">
          <div className="text-[11px] font-bold text-muted mb-1">{g.label}</div>
          <div className="grid grid-cols-8 gap-0.5">
            {g.items.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => {
                  onPick(e);
                  onClose();
                }}
                className="w-8 h-8 rounded-lg hover:bg-primary-soft text-lg cursor-pointer"
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
