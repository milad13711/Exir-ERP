export type LetterBoxKey = 'number'|'date'|'attachments'|'subject'|'recipient'|'body'|'signature'|'paraphs'|'qr'|'confidentiality';
export type LetterBoxLayout = { visible: boolean; xMm: number; yMm: number; wMm: number; hMm: number; fontFamily: string; fontSizePt: number; bold: boolean; color: string; align: 'right'|'center'|'left'|'justify'; lineHeight: number };
export type LetterheadLayout = { pageSize: 'A4'|'A5'; orientation: 'portrait'|'landscape'; letterheadOnAllPages: boolean; boxes: Record<LetterBoxKey, LetterBoxLayout>; continuationMarginsMm: { top: number; bottom: number; left: number; right: number } };
export type LetterRenderInput = {
  letterhead: { imageDataUri: string | null; layout: LetterheadLayout };
  number: string | null; dateText: string; subject: string; bodyHtml: string; /* already sanitised */
  attachmentsText: string | null; recipients: { name: string; title?: string | null }[]; ccNames: string[];
  sender: { name: string; title?: string | null };
  paraphs: { authorName: string; authorTitle?: string | null; text: string; dateText: string }[];
  signature: { imageDataUri: string | null; stampDataUri: string | null; signerName: string; signerTitle?: string | null; signedAtText: string } | null;
  qr: { verifyUrl: string } | null;
  watermark: 'پیش‌نویس' | 'باطل‌شده' | null; confidentialityLabel: string | null; priorityLabel: string | null;
};

export type IncomingSlipRenderInput = {
  orgName: string; secretariatNumber: string; registeredAtText: string;
  externalNumber: string | null; externalDateText: string | null;
  senderName: string; subject: string; pageCount: number | null; attachmentsText: string | null;
  registrarName: string; qr: { verifyUrl: string } | null;
};
