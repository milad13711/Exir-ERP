export function currentStock(movements: Array<{ quantityDelta: number }>): number {
  return movements.reduce((sum, m) => sum + m.quantityDelta, 0);
}

export type WarehouseStockEntry = { warehouseId: string; warehouseName: string; quantity: number };

/** Same movements, broken down per warehouse — for a product's detail view. */
export function stockByWarehouse(
  movements: Array<{ quantityDelta: number; warehouseId: string; warehouse: { name: string } }>,
): WarehouseStockEntry[] {
  const byWarehouse = new Map<string, WarehouseStockEntry>();
  for (const m of movements) {
    const entry = byWarehouse.get(m.warehouseId) ?? { warehouseId: m.warehouseId, warehouseName: m.warehouse.name, quantity: 0 };
    entry.quantity += m.quantityDelta;
    byWarehouse.set(m.warehouseId, entry);
  }
  return [...byWarehouse.values()].filter((e) => e.quantity !== 0).sort((a, b) => a.warehouseName.localeCompare(b.warehouseName));
}
