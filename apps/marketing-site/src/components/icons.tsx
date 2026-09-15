import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function FactoryIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 21V10l5 3.5V10l5 3.5V10l6 4v7H3z" />
      <path d="M7 21v-4M12 21v-4M17 21v-4" />
    </svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9.5V20h12V9.5" />
      <path d="M10 20v-6h4v6" />
    </svg>
  );
}

export function CelebrationIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 21 14 11" />
      <circle cx="17" cy="8" r="3.2" />
      <path d="M4 21l3-7 4 4-7 3z" />
    </svg>
  );
}

export function SparkleScissorsIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="6" cy="18" r="2.2" />
      <path d="M8 7.5 20 18M8 16.5 20 6" />
    </svg>
  );
}

export function MailPulseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="6" width="18" height="13" rx="2.2" />
      <path d="M3.5 7.5 11 13a1.6 1.6 0 0 0 2 0l7.5-5.5" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 12.5 9.5 17 19 7" />
    </svg>
  );
}

export function ShieldCheckIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export function LayersIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3 3 8l9 5 9-5-9-5z" />
      <path d="M3 12l9 5 9-5M3 16l9 5 9-5" />
    </svg>
  );
}

export function SparkAiIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <path d="M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function DnaIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M7 3c0 6 10 6 10 12" />
      <path d="M17 21c0-6-10-6-10-12" />
      <path d="M8.5 7h7M8.5 17h7" />
    </svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function GridIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.4" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.4" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.4" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.4" />
    </svg>
  );
}
