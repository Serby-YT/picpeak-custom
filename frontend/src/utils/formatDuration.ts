/**
 * Seconds to a clock label: 47s -> "0:47", 154s -> "2:34", 3725s -> "1:02:05".
 * Returns null when there is no usable duration, so callers can omit the label
 * entirely rather than printing a misleading "0:00".
 */
export function formatDuration(seconds?: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 1) {
    return null;
  }

  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}
