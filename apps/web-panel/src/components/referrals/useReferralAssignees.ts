"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchMyReferredIds, fetchReferralAssignees, type ReferralAssignee } from "@/lib/api";

/**
 * ستون «مسئول» و فیلتر «ارجاع‌های من» برای فهرست‌ها: برای شناسه‌های داده‌شده، مسئول پیگیری فعلی هر سند
 * و مجموعه‌ی سندهای ارجاع‌شده به کاربر جاری را برمی‌گرداند. خطا = بی‌صدا خالی (فهرست خراب نمی‌شود).
 */
export function useReferralAssignees(entityType: string, ids: string[]) {
  const [assignees, setAssignees] = useState<Record<string, ReferralAssignee>>({});
  const [mine, setMine] = useState<Set<string>>(new Set());
  const key = useMemo(() => ids.join(","), [ids]);

  useEffect(() => {
    let alive = true;
    fetchReferralAssignees(entityType, ids)
      .then((r) => alive && setAssignees(r))
      .catch(() => alive && setAssignees({}));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, key]);

  useEffect(() => {
    let alive = true;
    fetchMyReferredIds(entityType)
      .then((r) => alive && setMine(new Set(r.ids)))
      .catch(() => alive && setMine(new Set()));
    return () => {
      alive = false;
    };
  }, [entityType]);

  return { assignees, mine };
}
