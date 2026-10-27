/** برچسب فارسی فیلدهای آرگومان ابزارهای MCP + تشخیص متن آزاد ایجنت (تأییدنشده). */
export const FIELD_LABELS: Record<string, string> = {
  title: "عنوان", name: "نام", subject: "موضوع", type: "نوع", priority: "اولویت", dueAt: "موعد", startAt: "زمان شروع", endAt: "پایان",
  assigneeIds: "شناسه‌ی مسئول‌ها", taskId: "شناسه‌ی وظیفه", contactId: "شناسه‌ی مخاطب", supplierId: "شناسه‌ی تأمین‌کننده", phone: "تلفن",
  email: "ایمیل", company: "شرکت", stage: "مرحله", reason: "دلیل", body: "متن", bodyText: "متن", description: "توضیح", notes: "یادداشت", note: "یادداشت",
  externalNumber: "شماره‌ی اصلی نامه", externalDate: "تاریخ اصلی نامه", senderName: "فرستنده", senderOrgName: "سازمان فرستنده", recipients: "گیرنده‌ها",
  confidentiality: "محرمانگی", categoryId: "شناسه‌ی دسته", cargoType: "نوع بار", quantity: "تعداد", deliveryAddress: "آدرس تحویل", pickupAt: "زمان بارگیری",
  sourceType: "نوع منبع", sourceId: "شناسه‌ی منبع", serviceTypeId: "شناسه‌ی خدمت", customerName: "نام مشتری", customerPhone: "تلفن مشتری",
  date: "تاریخ", time: "ساعت", lines: "ردیف‌ها", value: "مقدار", sku: "کد کالا", unit: "واحد", salePrice: "قیمت فروش", costPrice: "بهای تمام‌شده",
  employeeId: "شناسه‌ی کارمند", startDate: "از تاریخ", endDate: "تا تاریخ", parentId: "شناسه‌ی نظر والد", tags: "برچسب‌ها",
};

/** فیلدهایی که متن آزادِ نوشته‌ی ایجنت‌اند و هیچ تضمینی درباره‌ی درستی یا نیت آن‌ها نیست. */
export const FREE_TEXT_FIELDS = new Set(["body", "bodyText", "description", "notes", "note", "reason", "instruction", "text", "comment", "attachmentsText", "message"]);

export function fieldLabel(k: string): string {
  return FIELD_LABELS[k] ?? k;
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "بله" : "خیر";
  if (typeof v === "string" || typeof v === "number") return String(v);
  return JSON.stringify(v, null, 1);
}
