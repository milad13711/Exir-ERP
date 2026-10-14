/**
 * موتور قوانین اسناد — خالص. هر قانون شرط (وزن خالص ≥ X و/یا نوع بار و/یا منطقه؛ همه‌ی شروط پرشده باید برقرار باشد)
 * و اسناد لازم + مسئول (نقش یا کاربر) دارد. قانون بدون هیچ شرطی همیشه برقرار است.
 */

export type DocRule = {
  id: string;
  name: string;
  isActive: boolean;
  minNetKg: number | null;
  cargoTypes: string[];
  regions: string[];
  docTypeCodes: string[];
  handlerRoleId: string | null;
  handlerUserId: string | null;
  sortOrder: number;
};

export type RuleFacts = { netKg: number | null; cargoType: string; region: string | null };

export const DEFAULT_MIN_NET_KG = 10_000;
export const DEFAULT_DOC_TYPES: Array<{ code: string; name: string; sortOrder: number }> = [
  { code: 'WAYBILL', name: 'بارنامه', sortOrder: 1 },
  { code: 'QUARANTINE', name: 'برگ قرنطینه', sortOrder: 2 },
  { code: 'WEIGHBRIDGE_TICKET', name: 'قبض باسکول', sortOrder: 3 },
  { code: 'SIGNED_RECEIPT', name: 'رسید امضاشده', sortOrder: 4 },
  { code: 'OTHER', name: 'سایر', sortOrder: 5 },
];

/** یکسان‌سازی متن فارسی برای مقایسه: ی/ک عربی، نیم‌فاصله، فاصله‌ی اضافه، حروف لاتین. */
export function normalizeText(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[‌‏‎]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function textMatches(list: string[], value: string | null): boolean {
  const v = normalizeText(value);
  if (!v) return false;
  return list.some((x) => {
    const n = normalizeText(x);
    return n.length > 0 && (v.includes(n) || n.includes(v));
  });
}

export function matchRule(rule: DocRule, facts: RuleFacts): boolean {
  if (!rule.isActive) return false;
  if (rule.minNetKg != null) {
    if (facts.netKg == null || facts.netKg < rule.minNetKg) return false;
  }
  if (rule.cargoTypes.length > 0 && !textMatches(rule.cargoTypes, facts.cargoType)) return false;
  if (rule.regions.length > 0 && !textMatches(rule.regions, facts.region)) return false;
  return true;
}

export type RuleEvaluation = {
  matched: DocRule[];
  requiredDocTypes: string[];
  handlerRoleIds: string[];
  handlerUserIds: string[];
};

export function evaluateRules(rules: DocRule[], facts: RuleFacts): RuleEvaluation {
  const matched = [...rules].filter((r) => matchRule(r, facts)).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const uniq = (xs: string[]) => [...new Set(xs)];
  return {
    matched,
    requiredDocTypes: uniq(matched.flatMap((r) => r.docTypeCodes)),
    handlerRoleIds: uniq(matched.map((r) => r.handlerRoleId).filter((x): x is string => !!x)),
    handlerUserIds: uniq(matched.map((r) => r.handlerUserId).filter((x): x is string => !!x)),
  };
}

export function missingDocTypes(required: string[], attachedCodes: string[]): string[] {
  const have = new Set(attachedCodes);
  return required.filter((c) => !have.has(c));
}

export function docsComplete(required: string[], attachedCodes: string[]): boolean {
  return missingDocTypes(required, attachedCodes).length === 0;
}

/** قانون پیش‌فرض: وزن خالص ≥ ۱۰٬۰۰۰ کیلوگرم → بارنامه + برگ قرنطینه. مسئول بعداً (نقش کنترل کیفیت) پر می‌شود. */
export function defaultRuleDraft(handlerRoleId: string | null): Omit<DocRule, 'id'> {
  return {
    name: 'بار سنگین (۱۰ تن و بیشتر)',
    isActive: true,
    minNetKg: DEFAULT_MIN_NET_KG,
    cargoTypes: [],
    regions: [],
    docTypeCodes: ['WAYBILL', 'QUARANTINE'],
    handlerRoleId,
    handlerUserId: null,
    sortOrder: 0,
  };
}

/** عنوان و متن وظیفه‌ی ثبت بارنامه — خالص تا آزمون‌پذیر باشد. */
export function buildDocsTaskText(input: {
  shipmentNo: number;
  customerName: string | null;
  uniqueId: string | null;
  nationalId: string | null;
  postalCode: string | null;
  postalAddress: string | null;
  netKg: number | null;
  cargoType: string;
  docNames: string[];
}): { title: string; description: string } {
  const dash = '—';
  const lines = [
    `مشتری: ${input.customerName ?? dash}`,
    `شناسه یکتا: ${input.uniqueId ?? dash}`,
    `کد ملی: ${input.nationalId ?? dash}`,
    `کد پستی: ${input.postalCode ?? dash}`,
    `آدرس پستی: ${input.postalAddress ?? dash}`,
    `نوع بار: ${input.cargoType}`,
    `وزن خالص: ${input.netKg != null ? `${input.netKg} کیلوگرم` : dash}`,
    `اسناد لازم: ${input.docNames.join('، ') || dash}`,
  ];
  const title = `ثبت ${input.docNames.slice(0, 2).join(' و ') || 'اسناد'} — بار #${input.shipmentNo}`;
  return { title, description: lines.join('\n') };
}
