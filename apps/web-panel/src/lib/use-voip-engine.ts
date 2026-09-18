"use client";

import { useEffect, useState } from "react";
import { voipEngine, type VoipEngineState } from "./voip-engine";

/** به موتور سافت‌فون مرورگری وصل می‌شود و init را (فقط یک‌بار، بی‌خطر با فراخوانی چندباره) صدا می‌زند. */
export function useVoipEngine(enabled: boolean): VoipEngineState {
  const [state, setState] = useState<VoipEngineState>(voipEngine.state);

  useEffect(() => {
    if (!enabled) return;
    voipEngine.init();
    return voipEngine.subscribe(setState);
  }, [enabled]);

  return state;
}
