import { t } from "@/lib/i18n";

export function ArchivePath({
  path,
  defaultPath,
}: {
  path: string;
  defaultPath?: string;
}) {
  if (path === defaultPath)
    return <span title={path}>{t("Anser default archive folder")}</span>;

  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (separator < 0)
    return (
      <span className="block truncate" title={path}>
        {path}
      </span>
    );

  return (
    <span
      className="flex min-w-0 max-w-full"
      dir="ltr"
      title={path}
      aria-label={path}
    >
      <span className="min-w-0 truncate">{path.slice(0, separator + 1)}</span>
      <span className="max-w-full shrink-0 truncate">
        {path.slice(separator + 1)}
      </span>
    </span>
  );
}
