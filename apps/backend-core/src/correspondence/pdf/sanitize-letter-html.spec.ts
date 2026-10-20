import { describe, expect, it } from 'vitest';
import { htmlSizeWithoutImages, letterHtmlToText, safeLetterImage, sanitizeLetterHtml, sanitizeStyle } from './sanitize-letter-html.js';

const TAGS = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'span', 'div', 'hr', 'img']);
const ATTRS = new Set(['style', 'dir', 'colspan', 'rowspan', 'src', 'alt']);

/** ناوردایی ساختاری: هر تگ و ویژگی در خروجی باید از فهرست مجاز باشد و هیچ الگوی اجرایی نماند. */
function assertSafe(out: string) {
  for (const m of out.matchAll(/<\/?([a-zA-Z0-9]+)((?:\s+[a-z-]+="[^"]*")*)\s*>/g)) {
    expect(TAGS.has(m[1]), `tag ${m[1]} in ${out}`).toBe(true);
    for (const a of m[2].matchAll(/\s+([a-z-]+)="([^"]*)"/g)) {
      expect(ATTRS.has(a[1]), `attr ${a[1]}`).toBe(true);
      if (a[1] === 'src') expect(a[2]).toMatch(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/);
      if (a[1] === 'style') expect(a[2]).not.toMatch(/url|expression|javascript|[\\'"<>]/i);
    }
  }
  // هیچ «<» خامی بیرون از تگ‌های بالا نمانده
  const stripped = out.replace(/<\/?([a-zA-Z0-9]+)((?:\s+[a-z-]+="[^"]*")*)\s*>/g, '');
  expect(stripped).not.toContain('<');
  expect(out).not.toMatch(/<\s*\/?\s*(script|iframe|object|embed|svg|style|link|meta|form|input|a)\b/i);
}

const PNG = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.from([0, 0, 0, 10, 0, 0, 0, 10]), Buffer.alloc(32, 1)]).toString('base64');

describe('sanitizeLetterHtml — محتوای مجاز', () => {
  it('قالب‌بندی ساده حفظ می‌شود', () => {
    const out = sanitizeLetterHtml('<p>سلام <strong>دنیا</strong> <em>x</em></p><ul><li>a</li><li>b</li></ul><h2>تیتر</h2><br><hr>');
    expect(out).toBe('<p>سلام <strong>دنیا</strong> <em>x</em></p><ul><li>a</li><li>b</li></ul><h2>تیتر</h2><br><hr>');
  });
  it('جدول با colspan/rowspan', () => {
    const out = sanitizeLetterHtml('<table><thead><tr><th colspan="2">h</th></tr></thead><tbody><tr><td rowspan=2>a</td><td>b</td></tr></tbody></table>');
    expect(out).toContain('<th colspan="2">');
    expect(out).toContain('<td rowspan="2">');
    assertSafe(out);
  });
  it('style امن: تراز، جهت، اندازه، رنگ', () => {
    const out = sanitizeLetterHtml('<p style="text-align: center; direction:rtl; font-size: 14pt; color:#AABBCC; margin: 0 4px 2px 0">x</p>');
    expect(out).toBe('<p style="text-align:center;direction:rtl;font-size:14pt;color:#aabbcc;margin:0 4px 2px 0">x</p>');
  });
  it('تصویر data:image/png معتبر می‌ماند', () => {
    const out = sanitizeLetterHtml(`<img src="${PNG}" alt="لوگو">`);
    expect(out).toBe(`<img src="${PNG}" alt="لوگو">`);
  });
  it('نسبت > در متن escape می‌شود و موجودیت معتبر می‌ماند', () => {
    expect(sanitizeLetterHtml('a < b > c &amp; d & e &lt;x&gt;')).toBe('a &lt; b &gt; c &amp; d &amp; e &lt;x&gt;');
  });
  it('تگ‌های باز بسته و نادرست تو در تو نرمال می‌شوند', () => {
    const out = sanitizeLetterHtml('<p><b>x<i>y</p>z</b>');
    assertSafe(out);
    expect(out).toBe('<p><b>x<i>y</i></b></p>z');
  });
  it('li باز بسته می‌شود', () => {
    expect(sanitizeLetterHtml('<ul><li>a<li>b</ul>')).toBe('<ul><li>a</li><li>b</li></ul>');
  });
  it('ورودی خالی/غیررشته', () => {
    expect(sanitizeLetterHtml('')).toBe('');
    expect(sanitizeLetterHtml(undefined as unknown as string)).toBe('');
  });
  it('لینک: تگ حذف و متن می‌ماند', () => {
    expect(sanitizeLetterHtml('<a href="http://evil.test">کلیک</a>')).toBe('کلیک');
    expect(sanitizeLetterHtml('<a href="javascript:alert(1)">کلیک</a>')).toBe('کلیک');
  });
});

describe('sanitizeLetterHtml — پیکره‌ی XSS', () => {
  const corpus: string[] = [
    '<script>alert(1)</script>',
    '<SCRIPT SRC=http://evil/x.js></SCRIPT>',
    '<scr<script>ipt>alert(1)</scr</script>ipt>',
    '<script/x>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<img src="x" onerror="alert(1)">',
    '<p onclick="alert(1)">x</p>',
    '<p onmouseover=alert(1)>x</p>',
    '<iframe src="javascript:alert(1)"></iframe>',
    '<iframe src="file:///etc/passwd"></iframe>',
    '<object data="http://evil/x.swf"></object>',
    '<embed src="http://evil/x.swf">',
    '<svg onload=alert(1)><circle r=1></svg>',
    '<svg><script>alert(1)</script></svg>',
    '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
    '<style>@import "http://evil/x.css"; body{background:url(http://evil)}</style>',
    '<link rel=stylesheet href="http://evil/x.css">',
    '<meta http-equiv="refresh" content="0;url=http://evil">',
    '<base href="http://evil/">',
    '<form action="http://evil"><input name=x></form>',
    '<p style="background:url(http://evil/x)">x</p>',
    '<p style="background-image:url(\'file:///etc/passwd\')">x</p>',
    '<p style="width:expression(alert(1))">x</p>',
    '<p style="color:red;background:url(javascript:alert(1))">x</p>',
    '<p style="behavior:url(x.htc)">x</p>',
    '<p style="-moz-binding:url(http://evil)">x</p>',
    '<p style="color:\\72 ed">x</p>',
    '<p style="c\\6flor:red">x</p>',
    '<p style="color:/**/red/**/;font-size:12pt">x</p>',
    '<p style="position:fixed;top:0;left:0;width:100%;height:100%">x</p>',
    '<p style="font-family:evil">x</p>',
    '<p style="content:\'x\'">x</p>',
    '<p style="margin:-9999px">x</p>',
    '<p style="font-size:9999px">x</p>',
    '<p style="color:&#x75;rl(http://evil)">x</p>',
    '<p style="background:&#117;rl(http://evil)">x</p>',
    '<img src="javascript:alert(1)">',
    '<img src="data:text/html,<script>alert(1)</script>">',
    '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">',
    '<img src="http://evil/x.png">',
    '<img src="//evil/x.png">',
    '<img src="file:///etc/passwd">',
    '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
    '<a href="&#106;avascript:alert(1)">x</a>',
    '<a href="jav&#x09;ascript:alert(1)">x</a>',
    '<<script>script>alert(1)<</script>/script>',
    '<img src="x"onerror="alert(1)">',
    '<img/src=x/onerror=alert(1)>',
    '<p\nonclick\n=\nalert(1)>x</p>',
    '<p title="><script>alert(1)</script>">x</p>',
    '<p class="x" id="y" data-a="1" onfocus=1 autofocus>x</p>',
    '<!--[if IE]><script>alert(1)</script><![endif]-->',
    '<![CDATA[<script>alert(1)</script>]]>',
    '<?xml version="1.0"?><script>alert(1)</script>',
    '<textarea><script>alert(1)</script></textarea>',
    '<title><script>alert(1)</script></title>',
    '<noscript><p title="</noscript><script>alert(1)</script>">',
    '<template><script>alert(1)</script></template>',
    '<xmp><script>alert(1)</script></xmp>',
    '<button onclick=alert(1)>x</button>',
    '<video src=x onerror=alert(1)></video>',
    '<details open ontoggle=alert(1)>x</details>',
    '<td colspan="2 onclick=alert(1)">x</td>',
    '＜script＞alert(1)＜/script＞',
    '<scr\u0000ipt>alert(1)</scr\u0000ipt>',
    '<p style="color:red" style="background:url(x)">x</p>',
    '<IMG SRC=JaVaScRiPt:alert(1)>',
    '<p onclick=alert(1',
    '<p style="x',
    '<img src="data:image/png;base64,AAAA" onerror=alert(1)>',
    '<img src="data:image/png;base64,$(evil)">',
    '<img src=\'data:image/png;base64,AAAA"onerror="alert(1)\'>',
    '<div dir="rtl onclick=alert(1)">x</div>',
  ];

  for (const [i, payload] of corpus.entries()) {
    it(`#${i} ${payload.slice(0, 50).replace(/\n/g, ' ')}`, () => {
      const out = sanitizeLetterHtml(payload);
      assertSafe(out);
      expect(out).not.toMatch(/on[a-z]+\s*=/i);
      expect(out).not.toMatch(/javascript:/i);
      expect(out).not.toMatch(/url\s*\(/i);
      expect(out).not.toMatch(/alert\(1\)<\/?script/i);
    });
  }

  it('اسکریپت همراه با محتوایش حذف می‌شود', () => {
    expect(sanitizeLetterHtml('a<script>alert(1)</script>b')).toBe('ab');
    expect(sanitizeLetterHtml('a<style>p{}</style>b')).toBe('ab');
    expect(sanitizeLetterHtml('a<script>never closed')).toBe('a');
  });
  it('تگ نیمه‌تمام در انتها حذف می‌شود', () => {
    expect(sanitizeLetterHtml('ok<img src="x')).toBe('ok');
  });
  it('نویسه‌های bidi override حذف می‌شوند', () => {
    expect(sanitizeLetterHtml('a‮b')).toBe('ab');
  });
  it('عمق تو در تو محدود است و فروپاشی نمی‌کند', () => {
    const out = sanitizeLetterHtml('<div>'.repeat(500) + 'x' + '</div>'.repeat(500));
    assertSafe(out);
    expect((out.match(/<div>/g) ?? []).length).toBeLessThanOrEqual(40);
  });
  it('ورودی عظیم/ساختار پیچیده در زمان معقول', () => {
    const t = Date.now();
    sanitizeLetterHtml('<p style="color:red">x</p>'.repeat(20000) + '<'.repeat(50000));
    expect(Date.now() - t).toBeLessThan(5000);
  });
  it('تصویر svg و gif و غیر-base64 حذف می‌شوند', () => {
    expect(sanitizeLetterHtml('<img src="data:image/svg+xml;base64,AAAA">')).toBe('');
    expect(sanitizeLetterHtml('<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">')).toBe('');
    expect(sanitizeLetterHtml('<img src="data:image/png,abcd">')).toBe('');
  });
});

describe('sanitizeStyle', () => {
  it('اعلان‌های ناامن حذف و امن حفظ', () => {
    expect(sanitizeStyle('color:red;text-align:right')).toBe('text-align:right');
    expect(sanitizeStyle('color:#fff;text-align:right')).toBe('color:#fff;text-align:right');
    expect(sanitizeStyle('color: rgb(1,2,3)')).toBe('color:rgb(1,2,3)');
    expect(sanitizeStyle('color: rgb(1,2,300)')).toBe('');
  });
  it('حدود اندازه‌ی فونت و حاشیه', () => {
    expect(sanitizeStyle('font-size:5pt')).toBe('');
    expect(sanitizeStyle('font-size:80pt')).toBe('');
    expect(sanitizeStyle('font-size:72pt')).toBe('font-size:72pt');
    expect(sanitizeStyle('margin:100px')).toBe('');
    expect(sanitizeStyle('padding:-4px')).toBe('');
  });
  it('!important و calc/var رد می‌شوند', () => {
    expect(sanitizeStyle('color:#fff !important')).toBe('');
    expect(sanitizeStyle('margin:calc(1px+1px)')).toBe('');
    expect(sanitizeStyle('color:var(--x)')).toBe('');
  });
});

describe('safeLetterImage', () => {
  it('magic bytes باید با نوع بخواند', () => {
    expect(safeLetterImage(PNG)).toBe(PNG);
    expect(safeLetterImage(PNG.replace('png', 'jpeg'))).toBeNull();
    expect(safeLetterImage('data:image/png;base64,' + Buffer.from('<svg onload=alert(1)>padding padding').toString('base64'))).toBeNull();
  });
  it('سقف حجم', () => {
    const big = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.from([0, 0, 0, 10, 0, 0, 0, 10]), Buffer.alloc(3145728, 1)]).toString('base64');
    expect(safeLetterImage(big)).toBeNull();
    expect(safeLetterImage(big, 4 * 1024 * 1024)).toBe(big);
  });
  it('htmlSizeWithoutImages داده‌ی تصویر را نمی‌شمارد', () => {
    expect(htmlSizeWithoutImages(`<p>x</p><img src="${PNG}">`)).toBeLessThan(60);
  });
});

describe('letterHtmlToText', () => {
  it('متن ساده با شکست خط', () => {
    expect(letterHtmlToText('<p>الف</p><p>ب &amp; ج</p><script>x</script>')).toBe('الف\nب & ج');
  });
});
