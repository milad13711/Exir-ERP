/** ادغام دلتای /sync/changes در فهرست محلی (خالص). */
export type DeltaResponse<T extends { id: string; updatedAt?: string }> = {
  mode: "full" | "delta";
  items: T[];
  nextSince: string | null;
  truncated: boolean;
  ids?: string[];
};

export function mergeDelta<T extends { id: string; updatedAt?: string }>(existing: T[], resp: DeltaResponse<T>, cap: number): T[] {
  const map = new Map<string, T>();
  if (resp.mode === "delta") for (const r of existing) map.set(r.id, r);
  for (const r of resp.items) map.set(r.id, r);
  if (resp.ids) {
    const keep = new Set(resp.ids);
    for (const id of [...map.keys()]) if (!keep.has(id)) map.delete(id);
  }
  const rows = [...map.values()];
  rows.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return rows.slice(0, cap);
}
