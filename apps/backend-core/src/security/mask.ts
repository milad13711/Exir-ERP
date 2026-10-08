/** ماسک شماره‌ی موبایل برای لاگ: 0912***789 */
export function maskPhone(p: string): string {
  return p.length >= 7 ? `${p.slice(0, 4)}***${p.slice(-3)}` : '***';
}
