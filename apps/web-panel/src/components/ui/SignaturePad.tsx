import { useRef, useState } from "react";

export function SignaturePad({ onDone, onCancel }: { onDone: (dataUrl: string) => void; onCancel?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasStroke, setHasStroke] = useState(false);

  function getCtx() {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.getContext("2d");
  }

  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    // The canvas's CSS size (rect, stretched to w-full) and its drawing-buffer
    // resolution (width/height attrs) can differ — without rescaling, the
    // stroke lands wherever the buffer's coordinate space maps to, not where
    // the mouse actually is.
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = getCtx();
    if (!ctx) return;
    drawing.current = true;
    const { x, y } = pointFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = getCtx();
    if (!ctx) return;
    const { x, y } = pointFromEvent(e);
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1c2333";
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasStroke(true);
  }

  function handlePointerUp() {
    drawing.current = false;
  }

  function handleClear() {
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasStroke(false);
  }

  function handleDone() {
    const canvas = canvasRef.current;
    if (!canvas || !hasStroke) return;
    onDone(canvas.toDataURL("image/png"));
  }

  return (
    <div className="flex flex-col gap-2.5">
      <canvas
        ref={canvasRef}
        width={380}
        height={140}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        className="w-full bg-slate-50 border border-border rounded-xl touch-none cursor-crosshair"
        style={{ height: 140 }}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleClear}
          className="flex-1 py-2 rounded-xl bg-slate-100 text-ink-soft text-[12.5px] font-bold cursor-pointer"
        >
          پاک کردن
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2 rounded-xl bg-slate-100 text-ink-soft text-[12.5px] font-bold cursor-pointer"
          >
            انصراف
          </button>
        ) : null}
        <button
          type="button"
          onClick={handleDone}
          disabled={!hasStroke}
          className="flex-1 py-2 rounded-xl bg-primary text-white text-[12.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          ثبت امضا
        </button>
      </div>
    </div>
  );
}
