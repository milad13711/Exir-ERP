import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_FONTS, extraFontFiles } from '../letterhead-layout.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = join(__dirname, '../../../node_modules/@fontsource-variable/vazirmatn/files');

const SUBSETS: { file: string; range: string }[] = [
  { file: 'vazirmatn-arabic-wght-normal.woff2', range: 'U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC' },
  { file: 'vazirmatn-latin-ext-wght-normal.woff2', range: 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF' },
  { file: 'vazirmatn-latin-wght-normal.woff2', range: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' },
];

let vazirCss: string | null = null;
const extraCache = new Map<string, string>();

/** @font-face های Vazirmatn (سه زیرمجموعه، data-URI؛ هیچ درخواست شبکه‌ای در زمان رندر). */
export function vazirmatnFontCss(): string {
  if (vazirCss) return vazirCss;
  vazirCss = SUBSETS.map(
    (s) =>
      `@font-face{font-family:'Vazirmatn';font-weight:100 900;font-style:normal;src:url(data:font/woff2;base64,${readFileSync(join(FONT_DIR, s.file)).toString('base64')}) format('woff2');unicode-range:${s.range};}`,
  ).join('\n');
  return vazirCss;
}

const MIME: Record<string, [string, string]> = { woff2: ['font/woff2', 'woff2'], woff: ['font/woff', 'woff'], ttf: ['font/ttf', 'truetype'], otf: ['font/otf', 'opentype'] };

/** CSS فونت‌های لازم: Vazirmatn همیشه؛ فونت‌های اضافه‌ی مستأجر (LETTER_FONTS_DIR) فقط اگر در families باشند. */
export function fontCssFor(families: Iterable<string>): string {
  const used = new Set(families);
  let css = vazirmatnFontCss();
  const extras = extraFontFiles();
  for (const fam of used) {
    if ((BUILTIN_FONTS as readonly string[]).includes(fam)) continue;
    const path = extras.get(fam);
    if (!path) continue;
    let c = extraCache.get(path);
    if (!c) {
      const ext = path.split('.').pop()!.toLowerCase();
      const [mime, fmt] = MIME[ext] ?? MIME.ttf;
      c = `@font-face{font-family:'${fam}';font-weight:100 900;src:url(data:${mime};base64,${readFileSync(path).toString('base64')}) format('${fmt}');}`;
      extraCache.set(path, c);
    }
    css += '\n' + c;
  }
  return css;
}

/** پشته‌ی فونت CSS: نام مجاز (از فهرست سفید اعتبارسنجی‌شده) + جایگزین‌ها. */
export function fontStack(family: string): string {
  const safe = family.replace(/[^A-Za-z0-9 _-]/g, '');
  return `'${safe}','Vazirmatn',Tahoma,Arial,sans-serif`;
}
