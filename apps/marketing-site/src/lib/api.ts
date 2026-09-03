const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
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
