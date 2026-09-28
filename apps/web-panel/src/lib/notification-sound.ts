// No pre-recorded audio asset exists anywhere in this codebase (checked SupportChat /
// SupportLiveNotifier, the only other real-time-ish surfaces) — this generates a short,
// two-tone chime with the Web Audio API instead of shipping an mp3/wav file.
let sharedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedCtx) sharedCtx = new Ctor();
  return sharedCtx;
}

/** پخش صدای کوتاه هنگام رسیدن اعلان جدید — فقط وقتی کاربر آن را در تنظیمات فعال کرده باشد. */
export function playNotificationSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const resume = ctx.state === "suspended" ? ctx.resume() : Promise.resolve();
    resume
      .then(() => {
        const now = ctx.currentTime;
        [880, 1175].forEach((freq, i) => {
          const oscillator = ctx.createOscillator();
          const gain = ctx.createGain();
          oscillator.type = "sine";
          oscillator.frequency.value = freq;
          const start = now + i * 0.11;
          gain.gain.setValueAtTime(0, start);
          gain.gain.linearRampToValueAtTime(0.16, start + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
          oscillator.connect(gain);
          gain.connect(ctx.destination);
          oscillator.start(start);
          oscillator.stop(start + 0.24);
        });
      })
      .catch(() => {});
  } catch {
    // مرورگرهایی که Web Audio ندارند یا سیاست autoplay را اعمال می‌کنند — بی‌صدا نادیده گرفته شود
  }
}
