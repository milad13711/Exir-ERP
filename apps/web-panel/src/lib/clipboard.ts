/**
 * `navigator.clipboard` only exists in a secure context (HTTPS) — on plain
 * HTTP (still the case for this deployment until a domain+TLS is set up,
 * see project_production_network_filtering) the API is simply `undefined`,
 * so calling `.writeText` throws and every "copy link" button silently does
 * nothing. Falls back to the older `document.execCommand('copy')` trick via
 * a temporary offscreen textarea, which works without a secure context.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // می‌افتد روی راه جایگزین زیر
    }
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
