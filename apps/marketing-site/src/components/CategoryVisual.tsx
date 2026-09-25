import type { ReactNode } from "react";

type CategoryStyle = { color: string; soft: string; icon: ReactNode };

const ICON_PROPS = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const CATEGORIES: Record<string, CategoryStyle> = {
  "بهره‌وری": {
    color: "#7c3aed",
    soft: "#ede9fe",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
  "فروش و مشتری": {
    color: "#db2777",
    soft: "#fce7f3",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
      </svg>
    ),
  },
  "انبار": {
    color: "#0891b2",
    soft: "#cffafe",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M3 9.5L12 4l9 5.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" />
      </svg>
    ),
  },
  "مالی": {
    color: "#059669",
    soft: "#d1fae5",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v10M9.5 9.5c0-1.4 1.2-2 2.5-2s2.5.7 2.5 2-1.2 1.7-2.5 2-2.5.6-2.5 2 1.2 2 2.5 2 2.5-.6 2.5-2" />
      </svg>
    ),
  },
  "منابع انسانی": {
    color: "#ea580c",
    soft: "#ffedd5",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="8.5" cy="7" r="3.5" />
        <path d="M2 21v-1a6 6 0 0 1 6-6h1a6 6 0 0 1 6 6v1" />
        <path d="M17 11a3 3 0 1 0 0-6M22 21v-1a5 5 0 0 0-4-4.9" />
      </svg>
    ),
  },
  "خرید و تأمین": {
    color: "#0b5a3c",
    soft: "#e0e7ff",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M3 7h18l-1.5 10.5a2 2 0 0 1-2 1.5H6.5a2 2 0 0 1-2-1.5z" />
        <path d="M8 7V5a4 4 0 0 1 8 0v2" />
      </svg>
    ),
  },
  "تولید": {
    color: "#b45309",
    soft: "#fef3c7",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M2 20h20M4 20V10l4 3V10l4 3V10l4 3V6l4 3v11" />
      </svg>
    ),
  },
  "یکپارچه‌سازی": {
    color: "#0284c7",
    soft: "#e0f2fe",
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="2" y="9" width="6" height="6" rx="1" />
        <rect x="16" y="9" width="6" height="6" rx="1" />
        <path d="M8 12h8" />
      </svg>
    ),
  },
  "عمومی": {
    color: "#475569",
    soft: "#f1f5f9",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.36.2.75.2 1.15" />
      </svg>
    ),
  },
  "عملیات": {
    color: "#0f766e",
    soft: "#ccfbf1",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M2 8h11v8H2z" />
        <path d="M13 11h4l4 3v2h-8z" />
        <circle cx="6" cy="18" r="1.8" />
        <circle cx="17" cy="18" r="1.8" />
      </svg>
    ),
  },
};

const DEFAULT_STYLE: CategoryStyle = {
  color: "#0b5a3c",
  soft: "#e0e7ff",
  icon: (
    <svg {...ICON_PROPS}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
    </svg>
  ),
};

export function categoryStyle(category: string): CategoryStyle {
  return CATEGORIES[category] ?? DEFAULT_STYLE;
}

export function CategoryVisual({ category, size = 44 }: { category: string; size?: number }) {
  const style = categoryStyle(category);
  return (
    <div
      className="rounded-xl flex items-center justify-center shrink-0"
      style={{ width: size, height: size, background: style.soft, color: style.color }}
    >
      <div style={{ width: size * 0.5, height: size * 0.5 }}>{style.icon}</div>
    </div>
  );
}
