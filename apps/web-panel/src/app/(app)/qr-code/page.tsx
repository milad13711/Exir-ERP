"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { ModuleHelp } from "@/components/ui/ModuleHelp";
import { QrCodeIcon, PlusIcon, SearchIcon } from "@/components/icons";
import { toPersianDigits } from "@/lib/persian";
import { fetchQrCodes, type QrCodeItem } from "@/lib/api";
import { NewQrCodeModal } from "@/components/qr-code/NewQrCodeModal";
import { QrCodeDetailModal } from "@/components/qr-code/QrCodeDetailModal";

export default function QrCodePage() {
  const [items, setItems] = useState<QrCodeItem[] | null>(null);
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  function reload() {
    fetchQrCodes().then(setItems).catch(() => setItems([]));
  }
  useEffect(reload, []);

  const filtered = (items ?? []).filter((i) => !search.trim() || i.label.includes(search) || i.targetUrl.includes(search));

  return (
    <div className="p-5 lg:p-7 max-w-[900px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">کد QR</h1>
            <ModuleHelp code="qr-code" />
          </div>
          <p className="text-[13.5px] text-muted mt-1">برای هر لینک دلخواه یک کد QR اختصاصی بسازید که با اسکن، مخاطب مستقیم وارد همان صفحه می‌شود</p>
        </div>
        <button
          onClick={() => setNewOpen(true)}
          className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer"
        >
          <PlusIcon className="w-4 h-4" />
          QR جدید
        </button>
      </div>

      <div className="relative max-w-[300px] mt-6 mb-4">
        <SearchIcon className="w-4 h-4 text-muted absolute top-1/2 -translate-y-1/2 right-3.5" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="جستجوی عنوان یا لینک..."
          className="w-full text-[13px] outline-none placeholder:text-muted bg-surface border border-border rounded-xl pr-10 pl-3.5 py-2.5 focus:border-primary transition-colors"
        />
      </div>

      <Card className="p-2">
        {items === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">هنوز کد QR‌ای ساخته نشده است</div>
        ) : (
          filtered.map((item, i) => (
            <button
              key={item.id}
              onClick={() => setDetailId(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors ${
                i < filtered.length - 1 ? "border-b border-border" : ""
              }`}
            >
              <div className="w-9 h-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
                <QrCodeIcon className="w-4.5 h-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold truncate">{item.label}</div>
                <div className="text-[11.5px] text-muted mt-0.5 truncate" dir="ltr">
                  {item.targetUrl}
                </div>
              </div>
              <div className="text-[11.5px] text-muted shrink-0">{toPersianDigits(item.scanCount)} اسکن</div>
            </button>
          ))
        )}
      </Card>

      {newOpen && (
        <NewQrCodeModal
          onClose={() => setNewOpen(false)}
          onCreated={(id) => {
            setNewOpen(false);
            reload();
            setDetailId(id);
          }}
        />
      )}
      {detailId && <QrCodeDetailModal id={detailId} onClose={() => setDetailId(null)} onChanged={reload} />}
    </div>
  );
}
