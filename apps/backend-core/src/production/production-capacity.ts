/**
 * Given a BOM's base batch size and each raw-material line's current stock,
 * returns how much of the OUTPUT product could be produced right now — the
 * bottleneck is whichever raw material runs out first. Used both to gate
 * production-order creation and by the dashboard's "producible capacity"
 * widget (see DashboardService).
 */
export function computeProducibleOutputQty(
  batchOutputQty: number,
  lines: Array<{ quantityPerBatch: number; availableStock: number }>,
): number {
  if (lines.length === 0 || batchOutputQty <= 0) return 0;
  const limitingBatches = Math.min(
    ...lines.map((l) => (l.quantityPerBatch > 0 ? Math.floor(l.availableStock / l.quantityPerBatch) : Infinity)),
  );
  return Math.max(0, limitingBatches) * batchOutputQty;
}

/** Scales one BOM line's per-batch requirement to a specific planned output quantity. */
export function scaleRequirement(batchOutputQty: number, quantityPerBatch: number, quantityPlanned: number): number {
  return Math.ceil((quantityPerBatch * quantityPlanned) / batchOutputQty);
}
