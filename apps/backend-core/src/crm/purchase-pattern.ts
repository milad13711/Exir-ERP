/**
 * Per (customer, product) pair: how many days apart their purchases of that
 * product usually land, and whether they're now overdue relative to their
 * OWN pattern — not a fixed threshold. Lets sales follow up right when a
 * customer's usual reorder rhythm suggests they should be ordering again,
 * instead of everyone getting the same generic reminder cadence.
 */
export type PurchaseLine = {
  contactId: string;
  contactName: string;
  productId: string;
  productName: string;
  issuedAt: Date;
};

export type FollowUpCandidate = {
  contactId: string;
  contactName: string;
  productId: string;
  productName: string;
  avgIntervalDays: number;
  lastPurchaseAt: Date;
  daysSinceLastPurchase: number;
  daysOverdue: number;
};

export function computeCustomerFollowUps(lines: PurchaseLine[], now: Date): FollowUpCandidate[] {
  const byPair = new Map<string, PurchaseLine[]>();
  for (const line of lines) {
    const key = `${line.contactId}::${line.productId}`;
    const list = byPair.get(key) ?? [];
    list.push(line);
    byPair.set(key, list);
  }

  const candidates: FollowUpCandidate[] = [];
  for (const group of byPair.values()) {
    if (group.length < 2) continue; // need at least two purchases to know a rhythm exists
    const dates = group.map((l) => l.issuedAt.getTime()).sort((a, b) => a - b);
    const intervalsMs = dates.slice(1).map((t, i) => t - dates[i]);
    const avgIntervalMs = intervalsMs.reduce((s, v) => s + v, 0) / intervalsMs.length;
    const avgIntervalDays = avgIntervalMs / 86_400_000;
    if (avgIntervalDays < 1) continue; // repeat purchases the same day aren't a "rhythm"

    const lastPurchaseAt = new Date(dates[dates.length - 1]);
    const daysSinceLastPurchase = (now.getTime() - lastPurchaseAt.getTime()) / 86_400_000;
    const daysOverdue = daysSinceLastPurchase - avgIntervalDays;
    if (daysOverdue <= 0) continue;

    const sample = group[0];
    candidates.push({
      contactId: sample.contactId,
      contactName: sample.contactName,
      productId: sample.productId,
      productName: sample.productName,
      avgIntervalDays: Math.round(avgIntervalDays),
      lastPurchaseAt,
      daysSinceLastPurchase: Math.round(daysSinceLastPurchase),
      daysOverdue: Math.round(daysOverdue),
    });
  }

  return candidates.sort((a, b) => b.daysOverdue - a.daysOverdue);
}
