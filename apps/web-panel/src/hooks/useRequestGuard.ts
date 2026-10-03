"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Guards against out-of-order responses. Call `begin()` right before firing a
 * request; the returned `isCurrent()` is true only while no newer request has
 * started and the component is still mounted. Use it to drop stale results:
 *
 *   const isCurrent = begin();
 *   fetchX(q).then((r) => { if (isCurrent()) setRows(r); });
 */
export function useRequestGuard() {
  const counter = useRef(0);
  useEffect(() => {
    return () => {
      counter.current = -1;
    };
  }, []);
  return useCallback(() => {
    const id = ++counter.current;
    return () => counter.current === id;
  }, []);
}
