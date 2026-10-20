/**
 * پاک‌ساز HTML متن نامه (allowlist-based، بدون وابستگی).
 *
 * اصل طراحی: خروجی فقط از «قطعه‌های اعتبارسنجی‌شده» ساخته می‌شود (نام تگ از فهرست مجاز، ویژگی از فهرست مجاز، مقدار style
 * از الگوهای دقیق). هیچ رشته‌ی ورودی‌ای به‌صورت خام در خروجی کپی نمی‌شود؛ پس حتی اگر تحلیلگر ما با مرورگر اختلاف داشته باشد،
 * چیزی که منتشر می‌شود امن است. متن عادی escape می‌شود. تگ‌های خطرناک (script/style/iframe/svg/…) همراه با محتوا حذف می‌شوند.
 * لینک‌ها (a) حذف و فقط متن‌شان نگه داشته می‌شود. تصویر فقط data:image/(png|jpeg|webp);base64 با سقف حجم و بررسی magic bytes.
 */

export const MAX_LETTER_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_INPUT_CHARS = 12 * 1024 * 1024; // متن + تصاویر؛ سقف سخت‌تر در LetterPdfService
const MAX_DEPTH = 40;
const MAX_TAGS = 20000;
const MAX_IMAGES = 12;

const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'span', 'div', 'hr', 'img',
]);
const VOID_TAGS = new Set(['br', 'hr', 'img']);
/** تگ‌هایی که محتوایشان هم باید حذف شود (متن داخلشان کد/پرداخت‌نشدنی است). */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'svg', 'math', 'template', 'noscript',
  'textarea', 'title', 'xmp', 'noembed', 'noframes', 'plaintext', 'head', 'select', 'option', 'audio', 'video', 'canvas',
  'link', 'meta', 'base', 'form', 'button', 'input',
]);
const ATTRS: Record<string, readonly string[]> = {
  td: ['colspan', 'rowspan', 'style', 'dir'],
  th: ['colspan', 'rowspan', 'style', 'dir'],
  img: ['src', 'alt', 'style'],
  ol: ['style', 'dir'],
};
const DEFAULT_ATTRS = ['style', 'dir'];
const STYLE_TAGS_NONE = new Set(['br', 'hr']);

export function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** حذف نویسه‌های کنترلی و بازنویسی/جاسازی bidi (RLO/LRO…) که برای جعل ظاهر متن استفاده می‌شوند. */
function cleanChars(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮￾￿]/g, '');
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', colon: ':', semi: ';', lpar: '(', rpar: ')', sol: '/', bsol: '\\', num: '#', percnt: '%', comma: ',', period: '.', plus: '+', excl: '!', lowbar: '_', hyphen: '-', dash: '-' };

/** رمزگشایی موجودیت‌ها فقط برای «بازرسی» مقدار ویژگی‌ها (تا `&#x75;rl(` دور نزند)؛ خروجی هرگز از این مقدار خام ساخته نمی‌شود. */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (m, body: string) => {
    if (body[0] === '#') {
      const n = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return '';
      try {
        return String.fromCodePoint(n);
      } catch {
        return '';
      }
    }
    const v = NAMED_ENTITIES[body.toLowerCase()];
    return v ?? m;
  });
}

/** متن: موجودیت‌های معتبر حفظ، بقیه escape. */
function sanitizeText(raw: string): string {
  let out = '';
  let last = 0;
  const re = /&(?:#\d{1,7}|#x[0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g;
  let m: RegExpExecArray | null;
  const text = cleanChars(raw);
  while ((m = re.exec(text))) {
    out += escapeText(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  out += escapeText(text.slice(last));
  return out;
}

// ───── CSS ─────
const NUM = '-?(?:\\d{1,3}(?:\\.\\d{1,3})?)';
const reHexColor = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const reRgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d{1,3})\s*)?\)$/i;
const reLen = new RegExp(`^(${NUM})(px|pt|mm|em|rem|%)?$`);

function safeColor(v: string): string | null {
  if (reHexColor.test(v)) return v.toLowerCase();
  const m = reRgb.exec(v);
  if (m && [m[1], m[2], m[3]].every((n) => Number(n) <= 255)) return `rgb(${m[1]},${m[2]},${m[3]})`;
  return null;
}

/** طول کوچک و غیرمنفی (حاشیه/فاصله). */
function safeSmallLen(v: string, max = 60): string | null {
  const m = reLen.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] ?? '';
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  if (!unit && n !== 0) return null;
  if (unit === '%') return null;
  return `${n}${unit}`;
}

function safeFontSize(v: string): string | null {
  const m = /^(\d{1,3}(?:\.\d{1,2})?)(pt|px)$/.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  if (m[2] === 'pt' && n >= 6 && n <= 72) return `${n}pt`;
  if (m[2] === 'px' && n >= 8 && n <= 96) return `${n}px`;
  return null;
}

function boxShorthand(v: string): string | null {
  const parts = v.split(/\s+/).filter(Boolean);
  if (parts.length < 1 || parts.length > 4) return null;
  const out: string[] = [];
  for (const p of parts) {
    const s = safeSmallLen(p);
    if (!s) return null;
    out.push(s);
  }
  return out.join(' ');
}

function safeBorder(v: string): string | null {
  const m = /^(\d(?:\.\d)?)(px|pt)\s+(solid|dashed|dotted|none)\s+(\S+)$/i.exec(v.trim());
  if (!m || Number(m[1]) > 6) return null;
  const c = safeColor(m[4]);
  return c ? `${m[1]}${m[2].toLowerCase()} ${m[3].toLowerCase()} ${c}` : null;
}

type StyleRule = (v: string) => string | null;
const oneOf = (...vals: string[]): StyleRule => (v) => (vals.includes(v) ? v : null);
const STYLE_RULES: Record<string, StyleRule> = {
  'text-align': oneOf('right', 'left', 'center', 'justify'),
  direction: oneOf('rtl', 'ltr'),
  'unicode-bidi': oneOf('normal', 'embed', 'isolate'),
  'font-size': safeFontSize,
  'font-weight': (v) => (/^(normal|bold|[1-9]00)$/.test(v) ? v : null),
  'font-style': oneOf('normal', 'italic'),
  'text-decoration': oneOf('none', 'underline', 'line-through'),
  color: safeColor,
  'background-color': safeColor,
  'line-height': (v) => {
    const m = /^(\d(?:\.\d{1,2})?)$/.exec(v);
    if (m && Number(m[1]) >= 0.8 && Number(m[1]) <= 3) return m[1];
    const p = /^(\d{1,2}(?:\.\d)?)(px|pt)$/.exec(v);
    return p && Number(p[1]) >= 8 && Number(p[1]) <= 100 ? v : null;
  },
  'text-indent': (v) => safeSmallLen(v, 60),
  'vertical-align': oneOf('top', 'middle', 'bottom', 'baseline'),
  width: (v) => {
    const m = /^(\d{1,3}(?:\.\d)?)(%|px|mm)$/.exec(v);
    if (!m) return null;
    const n = Number(m[1]);
    return (m[2] === '%' && n <= 100) || (m[2] === 'px' && n <= 1000) || (m[2] === 'mm' && n <= 300) ? v : null;
  },
  border: safeBorder,
  'border-top': safeBorder,
  'border-bottom': safeBorder,
  'border-left': safeBorder,
  'border-right': safeBorder,
  margin: boxShorthand,
  padding: boxShorthand,
};
for (const side of ['top', 'right', 'bottom', 'left']) {
  STYLE_RULES[`margin-${side}`] = (v) => safeSmallLen(v);
  STYLE_RULES[`padding-${side}`] = (v) => safeSmallLen(v);
}

/** مقدار style → رشته‌ی امن ساخته‌شده از اعلان‌های اعتبارسنجی‌شده (یا ''). */
export function sanitizeStyle(rawValue: string): string {
  const decoded = cleanChars(decodeEntities(rawValue));
  // هر نشانه‌ی escape/کامنت/رشته/تابع غیرمجاز → کل style دور ریخته می‌شود
  if (/[\\"'<>`{}@]|\/\*|\*\/|expression|javascript|vbscript|behavior|binding|url\s*\(|image-set|var\s*\(|calc\s*\(|env\s*\(|attr\s*\(/i.test(decoded)) return '';
  const out: string[] = [];
  for (const decl of decoded.split(';')) {
    const idx = decl.indexOf(':');
    if (idx < 1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim().replace(/\s+/g, ' ');
    const rule = STYLE_RULES[prop];
    if (!rule || /!important/i.test(value)) continue;
    const safe = rule(value.toLowerCase());
    if (safe) out.push(`${prop}:${safe}`);
  }
  return out.join(';');
}

import { dimensionsAcceptable, readImageSize } from './image-dimensions.js';

// ───── تصویر ─────
export function safeLetterImage(src: string, maxBytes = MAX_LETTER_IMAGE_BYTES): string | null {
  const v = cleanChars(decodeEntities(src)).trim();
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(v);
  if (!m) return null;
  const b64 = m[2];
  if (b64.length % 4 === 1) return null;
  const bytes = Math.floor((b64.length * 3) / 4);
  if (bytes > maxBytes || bytes < 12) return null;
  let head: Buffer;
  try {
    head = Buffer.from(b64.slice(0, 32), 'base64');
  } catch {
    return null;
  }
  const type = m[1] as 'png' | 'jpeg' | 'webp';
  const ok =
    (type === 'png' && head.length >= 8 && head[0] === 0x89 && head.toString('latin1', 1, 4) === 'PNG') ||
    (type === 'jpeg' && head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) ||
    (type === 'webp' && head.length >= 12 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP');
  if (!ok) return null;
  // ابعاد (IHDR/SOF/VP8*): رد «بمب پیکسلی» (> ۲۵ مگاپیکسل یا ضلع > ۸۰۰۰)
  let full: Buffer;
  try {
    full = Buffer.from(b64, 'base64');
  } catch {
    return null;
  }
  if (!dimensionsAcceptable(readImageSize(type, full))) return null;
  return `data:image/${type};base64,${b64}`;
}

// ───── تحلیل ─────
type Attr = { name: string; value: string };

/** از موقعیت i (بعد از نام تگ) ویژگی‌ها را مثل مرورگر می‌خواند؛ برمی‌گرداند {attrs, end} یا null اگر تگ نیمه‌تمام است. */
function readAttrs(s: string, i: number): { attrs: Attr[]; end: number } | null {
  const attrs: Attr[] = [];
  const n = s.length;
  for (;;) {
    while (i < n && /[\s/]/.test(s[i])) i++;
    if (i >= n) return null;
    if (s[i] === '>') return { attrs, end: i + 1 };
    let ns = i;
    // نام ویژگی (مثل مرورگر، '=' در ابتدا بخشی از نام است)
    if (s[i] === '=') i++;
    while (i < n && !/[\s/>=]/.test(s[i])) i++;
    const name = s.slice(ns, i).toLowerCase();
    while (i < n && /\s/.test(s[i])) i++;
    let value = '';
    if (s[i] === '=') {
      i++;
      while (i < n && /\s/.test(s[i])) i++;
      if (i >= n) return null;
      if (s[i] === '"' || s[i] === "'") {
        const q = s[i];
        const close = s.indexOf(q, i + 1);
        if (close < 0) return null;
        value = s.slice(i + 1, close);
        i = close + 1;
      } else {
        const vs = i;
        while (i < n && !/[\s>]/.test(s[i])) i++;
        value = s.slice(vs, i);
      }
    }
    if (name) attrs.push({ name, value });
  }
}

export function sanitizeLetterHtml(html: string): string {
  if (typeof html !== 'string' || !html) return '';
  let s = html.length > MAX_INPUT_CHARS ? html.slice(0, MAX_INPUT_CHARS) : html;
  s = s.replace(/\u0000/g, '');
  const out: string[] = [];
  const stack: string[] = [];
  let tagCount = 0;
  let imgCount = 0;
  let i = 0;
  const n = s.length;

  const closeTop = () => {
    const t = stack.pop();
    if (t) out.push(`</${t}>`);
  };

  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) {
      out.push(sanitizeText(s.slice(i)));
      break;
    }
    if (lt > i) out.push(sanitizeText(s.slice(i, lt)));
    i = lt;
    // کامنت
    if (s.startsWith('<!--', i)) {
      const e = s.indexOf('-->', i + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    // <!doctype>, <![CDATA[, <?xml ?>
    if (s[i + 1] === '!' || s[i + 1] === '?') {
      const e = s.indexOf('>', i);
      i = e < 0 ? n : e + 1;
      continue;
    }
    // تگ پایانی
    const endM = /^<\/([a-zA-Z][^\s/>]*)/.exec(s.slice(i, i + 80));
    if (endM) {
      const e = s.indexOf('>', i);
      i = e < 0 ? n : e + 1;
      const name = endM[1].toLowerCase();
      if (ALLOWED_TAGS.has(name) && !VOID_TAGS.has(name)) {
        const idx = stack.lastIndexOf(name);
        if (idx >= 0) while (stack.length > idx) closeTop();
      }
      continue;
    }
    const startM = /^<([a-zA-Z][^\s/>]*)/.exec(s.slice(i, i + 80));
    if (!startM) {
      out.push('&lt;');
      i += 1;
      continue;
    }
    const name = startM[1].toLowerCase();
    const parsed = readAttrs(s, i + startM[0].length);
    if (!parsed) break; // تگ نیمه‌تمام تا پایان ورودی → دور ریخته
    i = parsed.end;
    if (++tagCount > MAX_TAGS) break;

    if (DROP_WITH_CONTENT.has(name)) {
      const closeRe = new RegExp(`</${name.replace(/[^a-z0-9]/g, '')}[\\s/>]`, 'i');
      const rest = s.slice(i);
      const cm = closeRe.exec(rest);
      if (!cm) {
        i = n;
      } else {
        const e = s.indexOf('>', i + cm.index);
        i = e < 0 ? n : e + 1;
      }
      continue;
    }
    if (!ALLOWED_TAGS.has(name)) continue; // مثل a/font/center: تگ حذف، متن می‌ماند

    const allowed = ATTRS[name] ?? DEFAULT_ATTRS;
    const kept: string[] = [];
    const seen = new Set<string>();
    let imgSrc: string | null = null;
    for (const a of parsed.attrs) {
      if (seen.has(a.name) || !allowed.includes(a.name)) continue;
      seen.add(a.name);
      const v = cleanChars(decodeEntities(a.value)).trim();
      if (a.name === 'style') {
        if (STYLE_TAGS_NONE.has(name)) continue;
        const st = sanitizeStyle(a.value);
        if (st) kept.push(`style="${st}"`);
      } else if (a.name === 'dir') {
        if (/^(rtl|ltr|auto)$/i.test(v)) kept.push(`dir="${v.toLowerCase()}"`);
      } else if (a.name === 'colspan' || a.name === 'rowspan') {
        if (/^\d{1,2}$/.test(v) && Number(v) >= 1 && Number(v) <= 50) kept.push(`${a.name}="${Number(v)}"`);
      } else if (a.name === 'src') {
        imgSrc = safeLetterImage(a.value);
      } else if (a.name === 'alt') {
        kept.push(`alt="${escapeText(v.slice(0, 200))}"`);
      }
    }

    if (name === 'img') {
      if (!imgSrc || ++imgCount > MAX_IMAGES) continue;
      out.push(`<img src="${imgSrc}"${kept.length ? ' ' + kept.join(' ') : ''}>`);
      continue;
    }
    if (VOID_TAGS.has(name)) {
      out.push(`<${name}${kept.length ? ' ' + kept.join(' ') : ''}>`);
      continue;
    }
    if (stack.length >= MAX_DEPTH) continue;
    // li خودکار می‌بندد li قبلی را
    if (name === 'li') {
      const li = stack.lastIndexOf('li');
      const list = Math.max(stack.lastIndexOf('ul'), stack.lastIndexOf('ol'));
      if (li > list && li >= 0) while (stack.length > li) closeTop();
    }
    if (name === 'td' || name === 'th') {
      const cell = Math.max(stack.lastIndexOf('td'), stack.lastIndexOf('th'));
      const tr = stack.lastIndexOf('tr');
      if (cell > tr && cell >= 0) while (stack.length > cell) closeTop();
    }
    if (name === 'tr') {
      const tr = stack.lastIndexOf('tr');
      const tbl = stack.lastIndexOf('table');
      if (tr > tbl && tr >= 0) while (stack.length > tr) closeTop();
    }
    stack.push(name);
    out.push(`<${name}${kept.length ? ' ' + kept.join(' ') : ''}>`);
  }
  while (stack.length) closeTop();
  return out.join('');
}

/** حجم متن بدون داده‌ی تصاویر (برای سقف ۵۰۰ کیلوبایتی بدنه). */
export function htmlSizeWithoutImages(html: string): number {
  return html.replace(/(<img src=")data:[^"]*(")/g, '$1$2').length;
}

/** HTML → متن ساده (برای جست‌وجو/خلاصه). */
export function letterHtmlToText(html: string): string {
  return decodeEntities(sanitizeLetterHtml(html).replace(/<\/(p|div|li|h[1-4]|tr|blockquote)>|<br>/g, '\n').replace(/<[^>]*>/g, ''))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
