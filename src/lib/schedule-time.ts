export function localDateTime(date = new Date(Date.now() + 60 * 60 * 1000)) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}
export function scheduledIso(value: string) {
  const date = new Date(value);
  if (
    !value ||
    !Number.isFinite(date.getTime()) ||
    date.getTime() <= Date.now()
  )
    throw new Error("请选择未来的发送时间");
  return date.toISOString();
}
