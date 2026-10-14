"use client";

import { use } from "react";
import { ShipmentDispatchDetail } from "@/components/dispatch/ShipmentDispatchDetail";

export default function DispatchShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ShipmentDispatchDetail shipmentId={id} />;
}
