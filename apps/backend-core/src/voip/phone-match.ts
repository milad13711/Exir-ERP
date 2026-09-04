/**
 * A caller-ID number from a PBX and a phone number typed into a CRM contact
 * rarely share the exact same format (+98..., 0098..., 0912..., or bare
 * 912...) — this normalizes an Iranian mobile/landline number down to its
 * last 10 significant digits so both sides compare equal regardless of
 * which prefix style was used.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0098')) return digits.slice(4);
  if (digits.startsWith('98')) return digits.slice(2);
  if (digits.startsWith('0')) return digits.slice(1);
  return digits;
}

export function phonesMatch(a: string, b: string): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return na.length > 0 && na === nb;
}
