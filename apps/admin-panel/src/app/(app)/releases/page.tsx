"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, ListSkeleton } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { INPUT, LABEL, BTN_PRIMARY, BTN_GHOST } from "@/components/ui/styles";
import { PackageIcon } from "@/components/icons";
import { formatJalaliDate } from "@/lib/persian";
import { ApiError } from "@/lib/api";
import { createRelease, fetchReleaseMeta, fetchReleases, type ReleaseMeta, type ReleaseRow } from "@/lib/module-releases-api";

export default function ReleasesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<ReleaseRow[] | null>(null);
  const [filter, setFilter] = useState<"" | "DRAFT" | "PUBLISHED">("");
  const [meta, setMeta] = useState<ReleaseMeta | null>(null);
  const [creating, setCreating] = useState(false);
  const [moduleCode, setModuleCode] = useState("");
  const [version, setVersion] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRows(null);
    fetchReleases(filter || undefined)
      .then(setRows)
      .catch(() => setRows([]));
  }, [filter]);

  async function openCreate() {
    setCreating(true);
    setError(null);
    if (!meta) fetchReleaseMeta().then(setMeta).catch(() => {});
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await createRelease({ moduleCode, version: version.trim(), title, summary: "", changes: [] });
      router.push(`/releases/${r.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "ساخت انتشار انجام نشد");
      setBusy(false);
    }
  }

  return (
    <div className="p-4 sm:p-5 lg:p-7 max-w-[900px] mx-auto">
      <PageHeader
        title="انتشار به‌روزرسانی ماژول‌ها"
        subtitle="تغییرات هر نسخه را بنویسید و به تننت‌هایی که آن ماژول را دارند اطلاع بدهید"
        action={
          <button type="button" className={BTN_PRIMARY} onClick={openCreate}>
            انتشار جدید
          </button>
        }
      />
      <div className="flex gap-1.5 my-4">
        {([["", "همه"], ["DRAFT", "پیش‌نویس"], ["PUBLISHED", "منتشرشده"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={`min-h-[40px] px-4 rounded-xl text-[12.5px] font-bold cursor-pointer ${filter === k ? "bg-primary text-white" : "bg-slate-100 text-ink-soft"}`}>
            {l}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {rows === null ? (
          <ListSkeleton />
        ) : rows.length === 0 ? (
          <EmptyState icon={<PackageIcon className="w-6 h-6" />}>هنوز انتشاری ثبت نشده است.</EmptyState>
        ) : (
          rows.map((r) => (
            <Link key={r.id} href={`/releases/${r.id}`}>
              <Card className="p-4 hover:border-primary transition-colors">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge tone="primary">{r.moduleName}</Badge>
                  <span className="text-[12.5px] font-bold text-ink-soft" dir="ltr">
                    v{r.version}
                  </span>
                  <Badge tone={r.status === "PUBLISHED" ? "success" : "warning"}>{r.status === "PUBLISHED" ? "منتشرشده" : "پیش‌نویس"}</Badge>
                  <span className="ms-auto text-[12px] text-muted">{formatJalaliDate(r.publishedAt ?? r.createdAt)}</span>
                </div>
                <div className="text-[15px] font-extrabold mt-2">{r.title}</div>
                <div className="text-[12px] text-muted mt-1">{r.changeCount} تغییر</div>
              </Card>
            </Link>
          ))
        )}
      </div>

      {creating ? (
        <Modal title="انتشار جدید" onClose={() => setCreating(false)}>
          <div className="flex flex-col gap-3.5">
            <div>
              <label className={LABEL}>ماژول</label>
              <select className={`${INPUT} text-[16px]`} value={moduleCode} onChange={(e) => setModuleCode(e.target.value)}>
                <option value="">انتخاب کنید…</option>
                {meta?.modules.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL}>شماره‌ی نسخه</label>
              <input className={`${INPUT} text-[16px]`} dir="ltr" placeholder="1.4.0" value={version} onChange={(e) => setVersion(e.target.value)} />
            </div>
            <div>
              <label className={LABEL}>عنوان انتشار</label>
              <input className={`${INPUT} text-[16px]`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
            </div>
            {error ? <div className="text-[12.5px] text-danger font-semibold">{error}</div> : null}
            <div className="flex gap-2 justify-end">
              <button type="button" className={BTN_GHOST} onClick={() => setCreating(false)}>
                انصراف
              </button>
              <button type="button" className={BTN_PRIMARY} disabled={busy || !moduleCode || !version.trim() || !title.trim()} onClick={submit}>
                ساخت پیش‌نویس
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
