import { Suspense } from "react";
import { ConfigureClient } from "./ConfigureClient";

export default function ConfigurePage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-muted text-sm">در حال بارگذاری...</div>}>
      <ConfigureClient />
    </Suspense>
  );
}
