export type ByteRange = { start: number; end: number };
export type ByteRangeResult = ByteRange | "invalid" | null;

export function parseByteRangeHeader(header: string | null, totalBytes: number): ByteRangeResult {
  if (header === null) return null;
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) return "invalid";

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return "invalid";

  const startValue = match[1];
  const endValue = match[2];
  if (!startValue) {
    const suffixLength = Number(endValue);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return "invalid";
    return { start: Math.max(totalBytes - suffixLength, 0), end: totalBytes - 1 };
  }

  const start = Number(startValue);
  if (!Number.isSafeInteger(start) || start < 0 || start >= totalBytes) return "invalid";
  if (!endValue) return { start, end: totalBytes - 1 };

  const requestedEnd = Number(endValue);
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return "invalid";
  return { start, end: Math.min(requestedEnd, totalBytes - 1) };
}
