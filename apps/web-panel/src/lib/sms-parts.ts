/** تعداد بخش‌های پیامک (همان قاعده‌ی سرور): یونیکد ۷۰ / ۶۷، لاتین ۱۶۰ / ۱۵۳. */
export function smsPartsOf(message: string): number {
  if (!message) return 0;
  const unicode = /[^\x00-\x7F]/.test(message);
  const [single, multi] = unicode ? [70, 67] : [160, 153];
  return message.length <= single ? 1 : Math.ceil(message.length / multi);
}
