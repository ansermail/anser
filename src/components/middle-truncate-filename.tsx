import { cn } from "cn";

export function splitFilenameExtension(name: string) {
  const match = /\.[^.\s\\/]{1,12}$/.exec(name);
  if (!match || match.index <= 0) return { base: name, ext: "" };
  return { base: name.slice(0, match.index), ext: match[0] };
}

export function MiddleTruncateFilename({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const { base, ext } = splitFilenameExtension(name);
  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-baseline truncate",
        className,
      )}
      title={name}
    >
      <span className="min-w-0 truncate">{base}</span>
      {ext && <span className="shrink-0">{ext}</span>}
    </span>
  );
}
