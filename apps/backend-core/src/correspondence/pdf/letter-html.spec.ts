import { describe, expect, it } from 'vitest';
import { defaultLayout } from '../letterhead-layout.js';
import type { IncomingSlipRenderInput, LetterRenderInput } from '../render-input.js';
import { buildLetterHtml, faDigits, faDigitsInHtml } from './letter-html.js';
import { buildSlipHtml } from './slip-html.js';

const PNG = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]).toString('base64');

function input(over: Partial<LetterRenderInput> = {}): LetterRenderInput {
  return {
    letterhead: { imageDataUri: PNG, layout: defaultLayout() },
    number: '1405/12', dateText: '1405/07/29', subject: 'موضوع <b>x</b>', bodyHtml: '<p>متن</p>', attachmentsText: '2 برگ',
    recipients: [{ name: 'علی <script>', title: 'مدیر' }], ccNames: ['الف', 'ب'], sender: { name: 'فرستنده', title: 'سمت' },
    paraphs: [{ authorName: 'پ', authorTitle: 'ت', text: 'متن پاراف', dateText: '1405/07/30' }],
    signature: { imageDataUri: PNG, stampDataUri: PNG, signerName: 'امضاکننده', signerTitle: 'مدیرعامل', signedAtText: '1405/07/31' },
    qr: { verifyUrl: 'https://x.test/v/1' }, watermark: null, confidentialityLabel: 'محرمانه', priorityLabel: null,
    ...over,
  };
}
const opts = { qrDataUri: PNG, flow: false, pageTotal: null, persianDigits: false };

describe('buildLetterHtml — جایگذاری جعبه‌ها', () => {
  it('هر جعبه با مختصات میلی‌متری چیدمان قرار می‌گیرد', () => {
    const lay = defaultLayout();
    lay.boxes.number = { ...lay.boxes.number, xMm: 12.5, yMm: 33, wMm: 61, hMm: 7 };
    const html = buildLetterHtml(input({ letterhead: { imageDataUri: null, layout: lay } }), opts);
    expect(html).toContain('class="box number" style="left:12.5mm;top:33mm;width:61mm;height:7mm;');
    expect(html).toMatch(/class="box date" style="left:15mm;top:46mm;width:60mm;height:8mm;font-family:'Vazirmatn'/);
    expect(html).toContain('class="box subject"');
    expect(html).toContain('class="box recipient"');
    expect(html).toContain('class="box signature"');
    expect(html).toContain('class="box paraphs"');
    expect(html).toContain('class="box qr"');
    expect(html).toContain('class="box confidentiality"');
  });
  it('جعبه‌ی نامرئی رندر نمی‌شود؛ جعبه‌ی بدون محتوا (پیوست null) هم نه', () => {
    const lay = defaultLayout();
    lay.boxes.date.visible = false;
    const html = buildLetterHtml(input({ letterhead: { imageDataUri: null, layout: lay }, attachmentsText: null }), opts);
    expect(html).not.toContain('class="box date"');
    expect(html).not.toContain('class="box attachments"');
  });
  it('فونت/اندازه/رنگ/تراز/ضخامت/فاصله‌ی خطوط هر جعبه', () => {
    const lay = defaultLayout();
    lay.boxes.subject = { ...lay.boxes.subject, fontFamily: 'Tahoma', fontSizePt: 14, bold: true, color: '#112233', align: 'center', lineHeight: 2 };
    const html = buildLetterHtml(input({ letterhead: { imageDataUri: null, layout: lay } }), opts);
    expect(html).toContain("font-family:'Tahoma','Vazirmatn',Tahoma,Arial,sans-serif;font-size:14pt;font-weight:700;color:#112233;text-align:center;line-height:2;");
  });
  it('همه‌ی مقادیر کاربر escape می‌شوند', () => {
    const html = buildLetterHtml(input(), opts);
    expect(html).toContain('موضوع &lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('علی &lt;script&gt;');
    expect(html).not.toMatch(/<script/i);
  });
  it('ورود فونت/رنگ نامعتبر (دور زدن اعتبارسنجی) در CSS تزریق نمی‌شود', () => {
    const lay = defaultLayout();
    lay.boxes.body.color = 'red;background:url(http://evil)';
    lay.boxes.body.fontFamily = "x';}</style><script>";
    const html = buildLetterHtml(input({ letterhead: { imageDataUri: null, layout: lay } }), opts);
    expect(html).not.toContain('http://evil');
    expect(html).not.toContain('<script>');
  });
  it('تصویر غیر data: دور انداخته می‌شود', () => {
    const html = buildLetterHtml(input({ letterhead: { imageDataUri: 'http://evil/x.png', layout: defaultLayout() } }), { ...opts, qrDataUri: 'http://evil/q.png' });
    expect(html).not.toContain('http://evil');
  });
  it('CSP سند: فقط data:', () => {
    expect(buildLetterHtml(input(), opts)).toContain("default-src 'none'; img-src data:; font-src data:");
  });
  it('پاراف‌ها، امضا، مهر، QR و واترمارک', () => {
    const html = buildLetterHtml(input({ watermark: 'پیش‌نویس' }), opts);
    expect(html).toContain('پاراف — پ (ت) — تاریخ: 1405/07/30:');
    expect(html).toContain('class="stamp"');
    expect(html).toContain('class="sigimg"');
    expect(html).toContain('صحت‌سنجی نامه');
    expect(html).toContain('<div class="wm">پیش‌نویس</div>');
  });
  it('بدون امضا: نام و سمت فرستنده با فضای امضای دستی', () => {
    const html = buildLetterHtml(input({ signature: null }), opts);
    expect(html).toContain('class="sigspace"');
    expect(html).toContain('فرستنده');
  });
  it('ارقام فارسی فقط در گره‌های متنی', () => {
    expect(faDigits('a1b2')).toBe('a۱b۲');
    expect(faDigitsInHtml('<p style="margin:0 4px" data="9">ab 12</p>')).toBe('<p style="margin:0 4px" data="9">ab ۱۲</p>');
    const html = buildLetterHtml(input(), { ...opts, persianDigits: true });
    expect(html).toContain('۱۴۰۵/۱۲');
  });
});

describe('buildLetterHtml — صفحه‌بندی', () => {
  it('@page اندازه‌ی برگه با حاشیه‌ی صفر (محتوای حاشیه‌ی @page نقاشی نمی‌شود)', () => {
    expect(buildLetterHtml(input(), opts)).toContain('@page{size:210mm 297mm;margin:0;}');
    const a5 = defaultLayout('A5', 'landscape');
    expect(buildLetterHtml(input({ letterhead: { imageDataUri: null, layout: a5 } }), opts)).toContain('@page{size:210mm 148mm;margin:0;}');
  });
  it('حالت تک‌صفحه: spacerها و padding از جعبه‌ی متن', () => {
    const html = buildLetterHtml(input(), opts);
    const b = defaultLayout().boxes.body; // x15 y98 w180 h130 → پایین 297-228=69، راست 15
    expect(html).toContain(`table.flow>thead>tr>td{height:${b.yMm}mm;padding:0;}`);
    expect(html).toContain('table.flow>tfoot>tr>td{height:69mm;padding:0;}');
    expect(html).toContain('table.flow>tbody>tr>td{padding:0 15mm 0 15mm;vertical-align:top;}');
    expect(html).toContain('<thead><tr><td></td></tr></thead><tfoot>');
  });
  it('حالت جریان: حاشیه‌ی ادامه + spacer اضافه‌ی صفحه‌ی اول + امضا بعد از متن', () => {
    const html = buildLetterHtml(input(), { ...opts, flow: true });
    expect(html).toContain('table.flow>thead>tr>td{height:20mm;');
    expect(html).toContain('table.flow>tfoot>tr>td{height:28mm;');
    expect(html).toContain('<div style="height:78mm"></div>'); // 98-20
    expect(html).not.toContain('class="box signature"');
    expect(html).not.toContain('class="box paraphs"');
    expect(html).not.toContain('class="box qr"');
    expect(html).toMatch(/<div class="tail"><div class="tailbox signature"/);
    // جعبه‌های ثابت بالای صفحه‌ی اول همچنان مطلق‌اند
    expect(html).toContain('class="box number"');
  });
  it('تکرار thead/tfoot و جلوگیری از شکستن ردیف/تصویر', () => {
    const html = buildLetterHtml(input(), opts);
    expect(html).toContain('.body tr,.body img{break-inside:avoid;}');
    expect(html).toContain('orphans:2;widows:2');
    expect(html).toContain('table.flow>thead,table.flow>tfoot{break-inside:avoid;}');
  });
  it('شماره‌ی صفحه: دقیقاً در کادر pageNumber، فقط برای نامه‌ی چندصفحه‌ای (پیش‌فرض)', () => {
    expect(buildLetterHtml(input(), { ...opts, flow: true, pageTotal: null })).not.toContain('class="box pnum"');
    expect(buildLetterHtml(input(), { ...opts, flow: true, pageTotal: 1 })).not.toContain('class="box pnum"');
    const html = buildLetterHtml(input(), { ...opts, flow: true, pageTotal: 3 });
    // کادر پیش‌فرض: x=75 y=274 w=60 h=5 ؛ صفحه‌ی k در top = (k-1)*297 + 274
    expect(html).toContain('class="box pnum" style="left:75mm;top:274mm;width:60mm;height:5mm;');
    expect(html).toContain('top:571mm;');
    expect(html).toContain('top:868mm;');
    expect(html).toContain('>صفحه ۱ از ۳<');
    expect(html).toContain('>صفحه ۳ از ۳<');
    expect(buildLetterHtml(input(), { ...opts, flow: true, pageTotal: 2, persianDigits: true })).toContain('صفحه ۱ از ۲');
  });
  it('سربرگ: فقط صفحه‌ی اول (bg1) یا همه‌ی صفحات (bgall ثابت)', () => {
    const first = buildLetterHtml(input(), opts);
    expect(first).toContain('<div class="bg1"></div>');
    expect(first).not.toContain('<div class="bgall"></div>');
    const lay = defaultLayout();
    lay.letterheadOnAllPages = true;
    const all = buildLetterHtml(input({ letterhead: { imageDataUri: PNG, layout: lay } }), opts);
    expect(all).toContain('<div class="bgall"></div>');
    expect(all).not.toContain('<div class="bg1"></div>');
    expect(buildLetterHtml(input({ letterhead: { imageDataUri: null, layout: lay } }), opts)).not.toContain('class="bgall"></div>');
  });
  it('RTL و متن دوطرفه', () => {
    const html = buildLetterHtml(input(), opts);
    expect(html).toContain('<html lang="fa" dir="rtl">');
    expect(html).toContain('text-align:justify');
  });
});

describe('buildSlipHtml', () => {
  const slip: IncomingSlipRenderInput = {
    orgName: 'شرکت <x>', secretariatNumber: '1405/وارده/7', registeredAtText: '1405/07/29', externalNumber: '55<', externalDateText: null,
    senderName: 'فرستنده"', subject: '<img src=x onerror=1>', pageCount: 3, attachmentsText: null, registrarName: 'ثبت‌کننده', qr: { verifyUrl: 'https://x' },
  };
  it('برگ ثبت: اندازه‌ی A6 افقی، شماره‌ی درشت، QR، escape', () => {
    const html = buildSlipHtml(slip, { variant: 'slip', qrDataUri: PNG, headerImageDataUri: null, persianDigits: false });
    expect(html).toContain('@page{size:148mm 105mm;margin:0;}');
    expect(html).toContain('<span class="num">1405/وارده/7</span>');
    expect(html).toContain('صحت‌سنجی ثبت');
    expect(html).toContain('شرکت &lt;x&gt;');
    expect(html).toContain('&lt;img src=x onerror=1&gt;');
    expect(html).not.toMatch(/<img src=x/);
    expect(html).toContain("default-src 'none'");
  });
  it('برچسب ۶۰×۴۰ میلی‌متر: شماره، تاریخ، QR', () => {
    const html = buildSlipHtml(slip, { variant: 'label', qrDataUri: PNG, headerImageDataUri: null, persianDigits: true });
    expect(html).toContain('@page{size:60mm 40mm;margin:0;}');
    expect(html).toContain('۱۴۰۵/وارده/۷');
    expect(html).toContain(`<img src="${PNG}"`);
  });
  it('تصویر سربرگ غیر data: نادیده', () => {
    const html = buildSlipHtml(slip, { variant: 'slip', qrDataUri: null, headerImageDataUri: 'http://evil/x.png', persianDigits: false });
    expect(html).not.toContain('http://evil');
  });
});
