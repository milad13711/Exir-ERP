const NON_LATIN_DIGITS: Record<string, string> = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

/** Trims and length-caps a free-text `q` query param. Returns undefined when empty/not a string. */
export function normalizeSearchTerm(q: unknown): string | undefined {
  if (typeof q !== 'string') return undefined;
  const t = q.trim().slice(0, 100);
  return t.length > 0 ? t : undefined;
}

/** If the term is purely digits (Latin/Persian/Arabic) and fits an Int column, returns it as a number. */
export function searchTermAsInt(term: string): number | undefined {
  const latin = term.replace(/[۰-۹٠-٩]/g, (d) => NON_LATIN_DIGITS[d] ?? d);
  if (!/^\d{1,9}$/.test(latin)) return undefined;
  return Number(latin);
}
