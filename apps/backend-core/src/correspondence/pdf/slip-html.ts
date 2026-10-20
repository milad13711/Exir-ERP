import { escapeHtml } from '../../common/pdf-font.js';
import { safeImgSrc } from '../../security/puppeteer-hardening.js';
import type { IncomingSlipRenderInput } from '../render-input.js';
import { vazirmatnFontCss } from './letter-fonts.js';

export type SlipVariant = 'slip' | 'label';
export type SlipHtmlOptions = { variant: SlipVariant; qrDataUri: string | null; headerImageDataUri: string | null; persianDigits: boolean };

export const SLIP_PAGE_MM = { slip: { w: 148, h: 105 }, label: { w: 60, h: 40 } } as const;

const FA = '۰۱۲۳۴۵۶۷۸۹';

/** برگ ثبت وارده (A6 افقی) یا برچسب ۶۰×۴۰ میلی‌متر. همه‌ی مقادیر escape می‌شوند. تابع خالص. */
export function buildSlipHtml(input: IncomingSlipRenderInput, opts: SlipHtmlOptions): string {
  const t = (s: string | number | null | undefined) => {
    const v = escapeHtml(String(s ?? ''));
    return opts.persianDigits ? v.replace(/[0-9]/g, (d) => FA[Number(d)]) : v;
  };
  const dims = SLIP_PAGE_MM[opts.variant];
  const qr = opts.qrDataUri ? safeImgSrc(opts.qrDataUri) : '';
  const header = opts.headerImageDataUri ? safeImgSrc(opts.headerImageDataUri) : '';
  const common = `${vazirmatnFontCss()}
@page{size:${dims.w}mm ${dims.h}mm;margin:0;}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;font-family:'Vazirmatn',Tahoma,sans-serif;direction:rtl;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.num{direction:ltr;unicode-bidi:isolate;display:inline-block;font-weight:800;letter-spacing:.3pt;}
`;

  if (opts.variant === 'label') {
    return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"><style>${common}
.l{width:${dims.w}mm;height:${dims.h}mm;padding:2mm 2.5mm;display:flex;gap:2mm;overflow:hidden;border:.3pt solid #000;}
.l .tx{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between;}
.l .org{font-size:6.5pt;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.l .big{font-size:15pt;line-height:1.1;}
.l .sm{font-size:6.5pt;}
.l img{width:18mm;height:18mm;align-self:center;}
</style></head><body><div class="l"><div class="tx"><div class="org">${t(input.orgName)}</div><div class="sm">شماره‌ی وارده</div><div class="big"><span class="num">${t(input.secretariatNumber)}</span></div><div class="sm">${t(input.registeredAtText)}</div></div>${qr ? `<img src="${qr}" alt="">` : ''}</div></body></html>`;
  }

  const rows: [string, string][] = [
    ['تاریخ ثبت', t(input.registeredAtText)],
    ['شماره‌ی نامه‌ی مبدأ', input.externalNumber ? `<span class="num" style="font-weight:600">${t(input.externalNumber)}</span>` : '—'],
    ['تاریخ نامه‌ی مبدأ', input.externalDateText ? t(input.externalDateText) : '—'],
    ['فرستنده', t(input.senderName)],
    ['موضوع', t(input.subject)],
    ['تعداد صفحات', input.pageCount != null ? t(input.pageCount) : '—'],
    ['پیوست', input.attachmentsText ? t(input.attachmentsText) : '—'],
    ['ثبت‌کننده', t(input.registrarName)],
  ];
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"><style>${common}
.s{width:${dims.w}mm;height:${dims.h}mm;padding:4mm 6mm;display:flex;flex-direction:column;overflow:hidden;}
.hd{height:15mm;flex:none;display:flex;align-items:center;justify-content:space-between;border-bottom:.6pt solid #333;padding-bottom:1.5mm;gap:4mm;}
.hd .logo{height:100%;flex:1;background:${header ? `url(${header}) top center/100% auto no-repeat` : 'none'};}
.hd .org{font-weight:800;font-size:10pt;}
.hd .ttl{font-size:8.5pt;font-weight:700;text-align:left;white-space:nowrap;}
.mid{flex:1;display:flex;gap:4mm;margin-top:2mm;min-height:0;}
.fields{flex:1;min-width:0;}
.fields .n{display:flex;align-items:baseline;gap:3mm;margin-bottom:1.5mm;}
.fields .n .lb{font-size:8pt;}.fields .n .num{font-size:24pt;line-height:1.1;}
table{border-collapse:collapse;width:100%;font-size:7.5pt;}
td{padding:.5mm 0;vertical-align:top;border-bottom:.3pt dotted #888;}td.k{width:27mm;color:#444;font-weight:600;white-space:nowrap;}
.qr{flex:none;width:24mm;text-align:center;font-size:6pt;}.qr img{width:24mm;height:24mm;display:block;}
.ft{flex:none;font-size:6.5pt;color:#555;text-align:center;border-top:.3pt solid #999;padding-top:1mm;}
</style></head><body><div class="s">
<div class="hd">${header ? '<div class="logo"></div>' : `<div class="org">${t(input.orgName)}</div>`}<div class="ttl">برگ ثبت نامه‌ی وارده<br><span style="font-weight:400">${header ? t(input.orgName) : ''}</span></div></div>
<div class="mid"><div class="fields"><div class="n"><span class="lb">شماره‌ی دبیرخانه:</span><span class="num">${t(input.secretariatNumber)}</span></div>
<table>${rows.map(([k, v]) => `<tr><td class="k">${k}</td><td>${v}</td></tr>`).join('')}</table></div>
${qr ? `<div class="qr"><img src="${qr}" alt=""><div>صحت‌سنجی ثبت</div></div>` : ''}</div>
<div class="ft">این برگ، رسید ثبت نامه در دبیرخانه است.</div></div></body></html>`;
}
