// Server components run inside the marketing container and need the
// backend's *internal* Docker-network address (a container generally can't
// reach the host's own public IP:port back in — hairpin NAT isn't reliably
// supported here, confirmed by a real 404 on every dynamic [code] route
// once traffic left the lucky build-time-cached static pages). Client
// components run in the visitor's browser and need the real public URL,
// which can never resolve an internal Docker service name — so the two
// contexts genuinely need different base URLs, not just a fallback chain.
const API_URL =
  typeof window === "undefined"
    ? (process.env.API_URL_INTERNAL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api")
    : (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api");

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  // Explicit no-store: this catalog data can change any time the tenant
  // admin adds/edits a module, and a stale build-time-cached response
  // (Next's fetch() defaults to force-cache) previously masked a real
  // networking failure by quietly serving day-old data forever instead of
  // erroring — always fetch fresh instead of trusting the framework default.
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!res.ok) {
    let message = "خطایی رخ داد، دوباره تلاش کنید";
    try {
      const body = await res.json();
      if (typeof body.message === "string") message = body.message;
    } catch {
      // no JSON body — keep the default message
    }
    throw new ApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}

export type PublicPlan = {
  code: string;
  name: string;
  priceMonthly: number;
  priceYearly: number | null;
  userLimit: number;
};

export type PublicModule = {
  code: string;
  name: string;
  description: string;
  category: string;
  priceMonthly: number;
  isCore: boolean;
  dependsOn: string[];
  features: string[];
};

export type PublicIndustryTemplate = {
  code: string;
  name: string;
  description: string;
  suggestedThemeColor: string | null;
  defaultModules: string[];
};

export type PlanQuote = {
  billingCycle: "monthly" | "yearly";
  plan: { code: string; name: string; price: number; userLimit: number };
  moduleLines: Array<{ code: string; name: string; price: number }>;
  total: number;
};

export function fetchPublicPlans() {
  return apiFetch<PublicPlan[]>("/public/catalog/plans");
}

export function fetchPublicModules() {
  return apiFetch<PublicModule[]>("/public/catalog/modules");
}

export function fetchPublicIndustryTemplates() {
  return apiFetch<PublicIndustryTemplate[]>("/public/catalog/industry-templates");
}

export function fetchQuote(data: { planCode: string; billingCycle: "monthly" | "yearly"; moduleCodes: string[] }) {
  return apiFetch<PlanQuote>("/public/catalog/quote", { method: "POST", body: JSON.stringify(data) });
}
