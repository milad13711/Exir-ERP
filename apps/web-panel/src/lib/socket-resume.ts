import type { Socket } from "socket.io-client";

const sockets = new Set<Socket>();
let wired = false;

function wake() {
  for (const s of sockets) {
    if (!s.connected && s.disconnected) s.connect();
  }
}

/**
 * socket.io با backoff نمایی دوباره وصل می‌شود، ولی وقتی تب/PWA ساعت‌ها در پس‌زمینه بوده (به‌ویژه iOS/Android که تایمرها را
 * مسکوت می‌کنند) ممکن است دقیقه‌ها قطع بماند. با بازگشت به برنامه یا برگشتن شبکه فوراً وصل می‌کنیم.
 */
export function reconnectOnResume(socket: Socket): void {
  if (typeof window === "undefined") return;
  sockets.add(socket);
  if (!wired) {
    wired = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") wake();
    });
    window.addEventListener("online", wake);
    window.addEventListener("pageshow", (e) => {
      if ((e as PageTransitionEvent).persisted) wake();
    });
  }
}

export function forgetSocket(socket: Socket | null): void {
  if (socket) sockets.delete(socket);
}
