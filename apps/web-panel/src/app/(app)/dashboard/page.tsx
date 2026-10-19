"use client";

import { DashboardBody } from "@/components/dashboard/DashboardBody";

/**
 * داشبورد کلی — چیدمان از سرور می‌آید (تنظیم مدیر + شخصی‌سازی کاربر، فقط ویجت‌های نصب‌شده و مجاز).
 * رجیستری ویجت‌ها: backend-core/src/dashboard/dashboard-widgets.ts و components/dashboard/DashboardWidgets.tsx
 */
export default function DashboardPage() {
  return <DashboardBody />;
}
