import { t } from "./i18n";
export function localDateTime(date = new Date(Date.now() + 60 * 60 * 1000)) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}
export function isScheduledTimeInFuture(value: string, now = Date.now()) {
  const date = new Date(value);
  return (
    Boolean(value) && Number.isFinite(date.getTime()) && date.getTime() > now
  );
}
export function nextScheduledMinute(now = new Date()) {
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);
  return localDateTime(next);
}
export function normalizeScheduledTime(value: string, now = Date.now()) {
  const earliest = nextScheduledMinute(new Date(now));
  return isScheduledTimeInFuture(value, now) &&
    new Date(value).getTime() > new Date(earliest).getTime()
    ? value
    : earliest;
}
export function scheduledIso(value: string) {
  const date = new Date(value);
  if (!isScheduledTimeInFuture(value))
    throw new Error(t("Choose a future send time"));
  return date.toISOString();
}
