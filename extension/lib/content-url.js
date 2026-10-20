// Description content never resolves URLs against the extension's own origin.
export function contentUrl(value) {
  if (typeof value !== 'string') return '';
  const input = value.trim();
  if (!/^https?:\/\//i.test(input) || /[\u0000-\u001f\u007f]/.test(input)) return '';
  try {
    const url = new URL(input);
    return !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
