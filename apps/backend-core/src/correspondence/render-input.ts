export type LetterBoxKey = 'number'|'date'|'attachments'|'subject'|'recipient'|'body'|'signature'|'paraphs'|'qr'|'confidentiality'|'pageNumber';
export type LetterBoxLayout = { visible: boolean; xMm: number; yMm: number; wMm: number; hMm: number; fontFamily: string; fontSizePt: number; bold: boolean; color: string; align: 'right'|'center'|'left'|'justify'; lineHeight: number };
/** تنظیمات شماره‌ی صفحه: قالب با {n} و {total}؛ از صفحه‌ی N؛ نمایش روی صفحه‌ی اول؛ ارقام فارسی. */
export type PageNumberOptions = { format: string; startFromPage: number; showOnFirstPage: boolean; /** نامه‌ی تک‌صفحه‌ای هم شماره بخورد؟ (پیش‌فرض خیر) */ showOnSinglePage: boolean; persianDigits: boolean };
export type LetterheadLayout = { pageSize: 'A4'|'A5'; orientation: 'portrait'|'landscape'; letterheadOnAllPages: boolean; boxes: Record<LetterBoxKey, LetterBoxLayout>; continuationMarginsMm: { top: number; bottom: number; left: number; right: number }; pageNumberOptions?: PageNumberOptions };
export type LetterRenderInput = {
  letterhead: { imageDataUri: string | null; layout: LetterheadLayout };
  number: string | null; dateText: string; subject: string; bodyHtml: string; /* already sanitised */
  attachmentsText: string | null; recipients: { name: string; title?: string | null }[]; ccNames: string[];
  sender: { name: string; title?: string | null };
  paraphs: { authorName: string; authorTitle?: string | null; text: string; dateText: string }[];
  signature: {
    imageDataUri: string | null; stampDataUri: string | null; signerName: string; signerTitle?: string | null; signedAtText: string;
    /** بلوک امضای سه‌خطی: خط ۱ (سمت + شرکت)، خط ۲ (پیشوند + نام)، خط ۳ = مهر/امضا. اگر نباشند از signerTitle/signerName ساخته می‌شود. */
    titleLine?: string | null; nameLine?: string | null;
    /** برچسب تاریخ زیر بلوک (مثلاً «تاریخ امضا: …»)؛ null/خالی = تاریخ چاپ نمی‌شود */
    dateLabel?: string | null;
  } | null;
  qr: { verifyUrl: string } | null;
  watermark: 'پیش‌نویس' | 'باطل‌شده' | null; confidentialityLabel: string | null; priorityLabel: string | null;
};

export type IncomingSlipRenderInput = {
  orgName: string; secretariatNumber: string; registeredAtText: string;
  externalNumber: string | null; externalDateText: string | null;
  senderName: string; subject: string; pageCount: number | null; attachmentsText: string | null;
  registrarName: string; qr: { verifyUrl: string } | null;
};
