/** صنف‌هایی که برایشان عکس واقعی داریم (public/industries/) — بقیه همچنان صحنه‌ی برداری زیر را می‌گیرند. */
const PHOTO_CODES = new Set([
  "livestock-feed",
  "retail-store",
  "restaurant-cafe",
  "technical-services",
  "wholesale-distribution",
  "auto-service",
  "business-consulting",
  "education-institute",
  "manufacturing",
  "construction",
  "medical-clinic",
]);

/** برای صنف‌هایی که عکس واقعی دارند یک `<img>` تمام‌قد، وگرنه یک تصویر برداری ساده و متناسب با هر صنف — نه یک آیکون تکی، یک صحنه‌ی کوچک. */
export function IndustryIllustration({ code, color = "#4338ca" }: { code: string; color?: string }) {
  if (PHOTO_CODES.has(code)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={`/industries/${code}.jpg`} alt="" className="w-full h-full object-cover" />
    );
  }

  const props = { viewBox: "0 0 200 140", className: "w-full h-full", xmlns: "http://www.w3.org/2000/svg" };

  switch (code) {
    case "livestock-feed":
      return (
        <svg {...props}>
          <rect width="200" height="140" fill={`${color}14`} />
          <rect x="40" y="35" width="42" height="75" rx="6" fill={color} />
          <path d="M40 35 L61 15 L82 35 Z" fill={color} opacity="0.85" />
          <rect x="52" y="60" width="18" height="50" fill="#fff" opacity="0.25" />
          <circle cx="140" cy="80" r="26" fill={color} opacity="0.25" />
          <path d="M128 92 q12 -30 24 0" stroke={color} strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M120 100 q20 -45 40 0" stroke={color} strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.6" />
          <rect x="10" y="110" width="180" height="6" fill={color} opacity="0.3" />
        </svg>
      );
    case "retail-store":
      return (
        <svg {...props}>
          <rect width="200" height="140" fill={`${color}14`} />
          <rect x="45" y="55" width="110" height="55" fill={color} opacity="0.85" />
          <path d="M35 55 L65 25 L135 25 L165 55 Z" fill={color} />
          <rect x="35" y="55" width="130" height="10" fill="#fff" opacity="0.35" />
          <rect x="85" y="75" width="30" height="35" fill="#fff" opacity="0.3" />
          <circle cx="150" cy="95" r="14" fill={color} opacity="0.3" />
          <path d="M143 95h14M150 88v14" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      );
    case "restaurant-cafe":
      return (
        <svg {...props}>
          <rect width="200" height="140" fill={`${color}14`} />
          <path d="M70 55h50v25a25 25 0 0 1-50 0z" fill={color} />
          <path d="M120 60h14a12 12 0 0 1 0 24h-10" stroke={color} strokeWidth="6" fill="none" />
          <path d="M78 35q4 8 0 14M92 35q4 8 0 14M106 35q4 8 0 14" stroke={color} strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.6" />
          <rect x="55" y="100" width="90" height="8" rx="4" fill={color} opacity="0.4" />
        </svg>
      );
    case "technical-services":
      return (
        <svg {...props}>
          <rect width="200" height="140" fill={`${color}14`} />
          <circle cx="100" cy="70" r="34" fill={color} opacity="0.18" />
          <path
            d="M118 50l10-10a16 16 0 0 1-20 20l-28 28a6 6 0 0 1-8-8l28-28a16 16 0 0 1 20-20z"
            fill={color}
          />
          <rect x="45" y="35" width="26" height="20" rx="3" fill={color} opacity="0.7" />
          <path d="M45 45h26" stroke="#fff" strokeWidth="2" opacity="0.5" />
        </svg>
      );
    case "wholesale-distribution":
      return (
        <svg {...props}>
          <rect width="200" height="140" fill={`${color}14`} />
          <rect x="20" y="65" width="70" height="35" fill={color} opacity="0.85" />
          <path d="M90 75h30l20 20v10h-50z" fill={color} />
          <circle cx="55" cy="105" r="10" fill="#fff" stroke={color} strokeWidth="4" />
          <circle cx="125" cy="105" r="10" fill="#fff" stroke={color} strokeWidth="4" />
          <rect x="35" y="45" width="20" height="20" fill={color} opacity="0.4" />
          <rect x="60" y="50" width="16" height="15" fill={color} opacity="0.55" />
        </svg>
      );
    case "auto-service":
      return (
        <svg {...props}>
          <rect width="200" height="140" fill={`${color}14`} />
          <path d="M35 85 L50 55 h60 l20 30 h10 v20 h-100 v-20 z" fill={color} />
          <circle cx="60" cy="105" r="12" fill="#fff" stroke={color} strokeWidth="5" />
          <circle cx="135" cy="105" r="12" fill="#fff" stroke={color} strokeWidth="5" />
          <rect x="65" y="60" width="20" height="18" fill="#fff" opacity="0.3" />
          <rect x="90" y="60" width="20" height="18" fill="#fff" opacity="0.3" />
        </svg>
      );
    case "business-consulting":
      return (
        <svg {...props}>
          <rect width="200" height="140" fill={`${color}14`} />
          <rect x="60" y="55" width="80" height="55" rx="6" fill={color} opacity="0.85" />
          <rect x="85" y="42" width="30" height="16" rx="4" fill={color} />
          <path d="M25 100 L50 75 L70 90 L110 50" stroke={color} strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
          <circle cx="110" cy="50" r="6" fill={color} />
        </svg>
      );
    default:
      return (
        <svg {...props}>
          <rect width="200" height="140" fill={`${color}14`} />
          <circle cx="100" cy="70" r="30" fill={color} opacity="0.5" />
        </svg>
      );
  }
}
