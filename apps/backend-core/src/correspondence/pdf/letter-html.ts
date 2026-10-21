import { escapeHtml } from '../../common/pdf-font.js';
import { pageDims, BOX_KEYS, DEFAULT_PAGE_NUMBER_OPTIONS } from '../letterhead-layout.js';
import type { LetterBoxKey, LetterBoxLayout, LetterRenderInput } from '../render-input.js';
import { fontCssFor, fontStack } from './letter-fonts.js';
import { safeImgSrc } from '../../security/puppeteer-hardening.js';

/**
 * ساخت HTML نامه — تابع خالص (قابل تست بدون Chromium).
 *
 * هندسه: `@page { margin: 0 }` — چون Chromium محتوای عادی را در ناحیه‌ی حاشیه‌ی @page نقاشی نمی‌کند (سربرگ/جعبه‌های بالا/پایین ناپدید
 * می‌شدند). حاشیه‌ها با جدول `thead/tfoot` تکرارشونده ساخته می‌شود: spacer بالا/پایین روی هر صفحه تکرار می‌شود.
 *  - حالت تک‌صفحه (flow=false): spacer بالا = y جعبه‌ی متن، spacer پایین = تا لبه‌ی پایین جعبه، padding افقی = x/عرض جعبه؛ پس «سرریز» یعنی
 *    صفحه‌ی دوم ساخته می‌شود (سرویس از شمار صفحات می‌فهمد) و جعبه‌های امضا/پاراف/QR در موقعیت ثابت‌شان روی صفحه‌ی اول هستند.
 *  - حالت جریان (flow=true، نامه‌ی چندصفحه‌ای): حاشیه‌ها = continuationMarginsMm؛ صفحه‌ی اول با یک spacer اضافه تا y جعبه‌ی متن پایین
 *    می‌آید؛ امضا/پاراف/QR بعد از متن می‌آیند؛ «صفحه x از y» با برچسب‌های مطلق در کف هر صفحه (top = k·H + H − 9mm).
 * مختصات جعبه‌ها همیشه نسبت به گوشه‌ی بالا-چپ برگه‌اند (position:absolute روی صفحه‌ی اول، چون مبدأ = برگه).
 */
export type LetterHtmlOptions = {
  qrDataUri: string | null;
  /** امضا/پاراف/QR پس از متن نامه (نامه‌های چندصفحه‌ای). */
  flow: boolean;
  /** تعداد کل صفحات برای «صفحه x از y» (فقط وقتی > 1)؛ null = بدون شماره. */
  pageTotal: number | null;
  persianDigits: boolean;
};

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export function faDigits(s: string): string {
  return s.replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}
/** ارقام فارسی فقط در گره‌های متنی (نه داخل ویژگی‌ها/تگ‌ها). */
export function faDigitsInHtml(html: string): string {
  return html.replace(/>([^<]+)</g, (_m, t: string) => `>${faDigits(t)}<`);
}

const mm = (n: number) => `${Math.round(n * 100) / 100}mm`;

function boxStyle(b: LetterBoxLayout, extra = ''): string {
  return `font-family:${fontStack(b.fontFamily)};font-size:${b.fontSizePt}pt;font-weight:${b.bold ? 700 : 400};color:${/^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#000'};text-align:${b.align};line-height:${b.lineHeight};${extra}`;
}

function absBox(b: LetterBoxLayout, cls: string, inner: string): string {
  return `<div class="box ${cls}" style="left:${mm(b.xMm)};top:${mm(b.yMm)};width:${mm(b.wMm)};height:${mm(b.hMm)};${boxStyle(b)}">${inner}</div>`;
}


function contentCss(body: LetterBoxLayout): string {
  return `.box{position:absolute;overflow:hidden;direction:rtl;overflow-wrap:anywhere;}
.lbl{font-weight:700;}
.rcp{font-weight:700;}.rcp .rtl-t{font-weight:400;}
.cc{font-size:.85em;margin-top:1mm;}
.conf{border:1.2pt solid currentColor;padding:.5mm 3mm;border-radius:1mm;display:inline-block;}
.sig{text-align:center;}.sig .sigimgs{position:relative;height:18mm;}
.sig .sigimg{position:absolute;left:50%;top:0;transform:translateX(-50%);max-height:16mm;max-width:100%;}
.sig .stamp{position:absolute;left:50%;top:0;transform:translateX(-10%);max-height:18mm;max-width:60%;opacity:.85;}
.sig .sigspace{height:14mm;}.sig .sl1,.sig .sl2{font-weight:700;}.sig .sl1{margin-bottom:.6mm;}.sig .sd{font-size:.85em;margin-top:.6mm;}
.paraphs .pr{margin-bottom:1.2mm;}
.qrw{display:flex;flex-direction:column;align-items:center;height:100%;}.qrw img{width:100%;max-height:calc(100% - 3mm);object-fit:contain;}.qrc{font-size:6pt;margin-top:.5mm;white-space:nowrap;}
.wm{position:fixed;top:48%;left:50%;transform:translate(-50%,-50%) rotate(-35deg);font-family:'Vazirmatn',Tahoma,sans-serif;font-size:84pt;font-weight:800;color:rgba(120,120,120,.16);white-space:nowrap;z-index:50;pointer-events:none;}
.body{${boxStyle(body)}direction:rtl;overflow-wrap:anywhere;}
.body p{margin:0 0 .6em;orphans:2;widows:2;}
.body h1,.body h2,.body h3,.body h4{margin:.8em 0 .4em;break-after:avoid;line-height:1.4;}
.body h1{font-size:1.5em}.body h2{font-size:1.3em}.body h3{font-size:1.15em}.body h4{font-size:1em}
.body ul,.body ol{margin:0 0 .6em;padding-inline-start:1.6em;}
.body li{margin-bottom:.15em;}
.body blockquote{margin:.6em 1em;padding:0 .8em;border-inline-start:2pt solid #94a3b8;break-inside:avoid;}
.body table{border-collapse:collapse;width:100%;margin:.4em 0;}
.body td,.body th{border:.6pt solid #64748b;padding:1mm 1.6mm;vertical-align:top;}
.body th{background:#f1f5f9;font-weight:700;}
.body tr,.body img{break-inside:avoid;}
.body img{max-width:100%;height:auto;}
.body hr{border:0;border-top:.6pt solid #94a3b8;margin:.8em 0;}
.tail{margin-top:8mm;break-inside:avoid;display:flow-root;}
.tailbox{margin-bottom:5mm;break-inside:avoid;page-break-inside:avoid;}
.tailbox.signature{break-inside:avoid;page-break-inside:avoid;}
.pnum{display:flex;align-items:center;justify-content:center;white-space:nowrap;}
.tailbox.qr{height:24mm;}
`;
}

export function buildLetterHtml(input: LetterRenderInput, opts: LetterHtmlOptions): string {
  const lay = input.letterhead.layout;
  const dims = pageDims(lay.pageSize, lay.orientation);
  const B = lay.boxes;
  const body = B.body;
  const cm = lay.continuationMarginsMm;
  const dg = opts.persianDigits ? faDigits : (s: string) => s;
  const t = (s: string | null | undefined) => escapeHtml(dg(s ?? ''));

  const bg = input.letterhead.imageDataUri ? safeImgSrc(input.letterhead.imageDataUri) : '';
  const families = new Set<string>(BOX_KEYS.map((k) => B[k].fontFamily));

  // ───── محتوای جعبه‌ها ─────
  const contents: Partial<Record<LetterBoxKey, string>> = {};
  contents.number = `<span class="lbl">شماره:</span> ${input.number ? t(input.number) : '—'}`;
  contents.date = `<span class="lbl">تاریخ:</span> ${t(input.dateText)}`;
  if (input.attachmentsText) contents.attachments = `<span class="lbl">پیوست:</span> ${t(input.attachmentsText)}`;
  contents.subject = `<span class="lbl">موضوع:</span> ${t(input.subject)}`;
  const recip = input.recipients
    .map((r) => `<div class="rcp">${t(r.name)}${r.title ? ` <span class="rtl-t">${t(r.title)}</span>` : ''}</div>`)
    .join('');
  const cc = input.ccNames.length ? `<div class="cc"><span class="lbl">رونوشت:</span> ${input.ccNames.map(t).join('، ')}</div>` : '';
  contents.recipient = recip + cc;
  const conf = [input.confidentialityLabel, input.priorityLabel].filter(Boolean).map((x) => t(x)).join(' &middot; ');
  if (conf) contents.confidentiality = `<span class="conf">${conf}</span>`;

  let signatureHtml = '';
  const sig = input.signature;
  const sigImg = sig?.imageDataUri ? safeImgSrc(sig.imageDataUri) : '';
  const stampImg = sig?.stampDataUri ? safeImgSrc(sig.stampDataUri) : '';
  if (sig) {
    // سه خط وسط‌چین داخل بلوک: ۱) سمت + شرکت ۲) پیشوند + نام ۳) مهر/امضا؛ سپس تاریخ اختیاری
    const titleLine = sig.titleLine ?? sig.signerTitle ?? '';
    const nameLine = sig.nameLine ?? sig.signerName;
    const dateLabel = sig.dateLabel === undefined ? sig.signedAtText : sig.dateLabel;
    signatureHtml = `<div class="sig">${titleLine ? `<div class="sl1">${t(titleLine)}</div>` : ''}${nameLine ? `<div class="sl2">${t(nameLine)}</div>` : ''}${
      sigImg || stampImg
        ? `<div class="sigimgs">${stampImg ? `<img class="stamp" src="${stampImg}" alt="">` : ''}${sigImg ? `<img class="sigimg" src="${sigImg}" alt="">` : ''}</div>`
        : '<div class="sigspace"></div>'
    }${dateLabel ? `<div class="sd">${t(dateLabel)}</div>` : ''}</div>`;
  } else if (input.sender.name) {
    signatureHtml = `<div class="sig">${input.sender.title ? `<div class="sl1">${t(input.sender.title)}</div>` : ''}<div class="sl2">${t(input.sender.name)}</div><div class="sigspace"></div></div>`;
  }
  const paraphHtml = input.paraphs.length
    ? `<div class="paraphs">${input.paraphs
        .map((p) => `<div class="pr"><b>پاراف — ${t(p.authorName)}${p.authorTitle ? ` (${t(p.authorTitle)})` : ''} — تاریخ: ${t(p.dateText)}:</b> ${t(p.text)}</div>`)
        .join('')}</div>`
    : '';
  const qrHtml = opts.qrDataUri && safeImgSrc(opts.qrDataUri) ? `<div class="qrw"><img src="${safeImgSrc(opts.qrDataUri)}" alt=""><div class="qrc">صحت‌سنجی نامه</div></div>` : '';

  // ───── جعبه‌های مطلق صفحه‌ی اول ─────
  const abs: string[] = [];
  const staticKeys: LetterBoxKey[] = ['number', 'date', 'attachments', 'subject', 'recipient', 'confidentiality'];
  for (const k of staticKeys) if (B[k].visible && contents[k]) abs.push(absBox(B[k], k, contents[k]!));
  if (!opts.flow) {
    if (B.signature.visible && signatureHtml) abs.push(absBox(B.signature, 'signature', signatureHtml));
    if (B.paraphs.visible && paraphHtml) abs.push(absBox(B.paraphs, 'paraphs', paraphHtml));
    if (B.qr.visible && qrHtml) abs.push(absBox(B.qr, 'qr', qrHtml));
  }

  // ───── پایان نامه در حالت جریان ─────
  let tail = '';
  if (opts.flow) {
    const place = (k: LetterBoxKey, html: string) => {
      if (!html || !B[k].visible) return '';
      const b = B[k];
      const center = b.xMm + b.wMm / 2;
      const side = center < dims.w / 3 ? 'margin-right:auto' : center > (dims.w * 2) / 3 ? 'margin-left:auto' : 'margin:0 auto';
      return `<div class="tailbox ${k}" style="width:${mm(Math.min(b.wMm, dims.w - cm.left - cm.right))};${side};${boxStyle(b)}">${html}</div>`;
    };
    tail = `<div class="tail">${place('signature', signatureHtml)}${place('paraphs', paraphHtml)}${place('qr', qrHtml)}</div>`;
  }

  const wm = input.watermark ? `<div class="wm">${escapeHtml(input.watermark)}</div>` : '';
  const bodyHtml = opts.persianDigits ? faDigitsInHtml(input.bodyHtml) : input.bodyHtml;

  const bgAll = !!bg && lay.letterheadOnAllPages;
  // جدول حاشیه: بالا/پایین (spacer تکرارشونده) + padding افقی سلول
  const topSpacer = opts.flow ? cm.top : body.yMm;
  const bottomSpacer = opts.flow ? cm.bottom : dims.h - body.yMm - body.hMm;
  const padL = opts.flow ? cm.left : body.xMm;
  const padR = opts.flow ? cm.right : dims.w - body.xMm - body.wMm;
  const pre = opts.flow && body.yMm > cm.top ? `<div style="height:${mm(body.yMm - cm.top)}"></div>` : '';

  // شماره‌ی صفحه: دقیقاً در کادر pageNumber (مختصات طراح سربرگ) روی هر صفحه
  const labels: string[] = [];
  const pnb = B.pageNumber;
  const pno = lay.pageNumberOptions ?? DEFAULT_PAGE_NUMBER_OPTIONS;
  if (pnb?.visible) {
    const total = Math.max(1, opts.pageTotal ?? 1);
    const fa = opts.persianDigits || pno.persianDigits;
    for (let k = 1; k <= total; k++) {
      if (total === 1 && !pno.showOnSinglePage) break;
      if (k < pno.startFromPage || (k === 1 && !pno.showOnFirstPage)) continue;
      const raw = pno.format.replace(/\{n\}/g, String(k)).replace(/\{total\}/g, String(total));
      const text = escapeHtml(fa ? faDigits(raw) : raw);
      const justify = pnb.align === 'left' ? 'flex-start' : pnb.align === 'right' ? 'flex-end' : 'center';
      labels.push(`<div class="box pnum" style="left:${mm(pnb.xMm)};top:${mm((k - 1) * dims.h + pnb.yMm)};width:${mm(pnb.wMm)};height:${mm(pnb.hMm)};justify-content:${justify};${boxStyle(pnb)}">${text}</div>`);
    }
  }

  return `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'">
<style>
${fontCssFor(families)}
@page{size:${dims.w}mm ${dims.h}mm;margin:0;}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;background:transparent;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
body{direction:rtl;position:relative;}
.bg1{position:absolute;left:0;top:0;width:${mm(dims.w)};height:${mm(dims.h)};z-index:-1;background:${bg ? `url(${bg}) center/100% 100% no-repeat` : 'none'};}
.bgall{position:fixed;left:0;top:0;width:${mm(dims.w)};height:${mm(dims.h)};z-index:-2;background:${bgAll ? `url(${bg}) center/100% 100% no-repeat` : 'none'};}
table.flow{border-collapse:collapse;border-spacing:0;width:${mm(dims.w)};table-layout:fixed;}
table.flow>thead,table.flow>tfoot{break-inside:avoid;}
table.flow>thead>tr>td{height:${mm(topSpacer)};padding:0;}
table.flow>tfoot>tr>td{height:${mm(bottomSpacer)};padding:0;}
table.flow>tbody>tr>td{padding:0 ${mm(padR)} 0 ${mm(padL)};vertical-align:top;}
${contentCss(body)}</style></head>
<body>
${wm}
${bgAll ? '<div class="bgall"></div>' : bg ? '<div class="bg1"></div>' : ''}
${abs.join('')}
${labels.join('')}
<table class="flow"><thead><tr><td></td></tr></thead><tfoot><tr><td></td></tr></tfoot><tbody><tr><td>${pre}<div class="body">${bodyHtml}${tail}</div></td></tr></tbody></table>
</body></html>`;
}
