import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * پروکسی هم‌مبدأ برای درخواست‌های مرورگرِ سایت به API عمومی. سایت روی HTTPS است و
 * بک‌اند روی آدرس HTTP خام؛ مرورگر درخواست HTTP از صفحه‌ی HTTPS را مسدود می‌کند
 * (mixed content)، پس فرم‌ها (نمایندگی، مشاوره، استعلام) بعد از تکمیل خطا می‌دادند.
 * اینجا درخواست سمت سرور و از مسیر داخلی داکر به بک‌اند می‌رود. فقط مسیرهای /public.
 */
async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const base = process.env.API_URL_INTERNAL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";
  const url = `${base.replace(/\/$/, "")}/public/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  try {
    const res = await fetch(url, {
      method: req.method,
      headers: {
        "Content-Type": req.headers.get("content-type") ?? "application/json",
        "X-Forwarded-For": req.headers.get("x-forwarded-for") ?? "",
      },
      body: hasBody ? await req.text() : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    return new Response(await res.text(), {
      status: res.status,
      headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return Response.json({ message: "سرویس در دسترس نیست، کمی بعد دوباره تلاش کنید" }, { status: 502 });
  }
}

export { forward as GET, forward as POST };
