import { Skeleton } from "./ui/skeleton";
export function MailBodySkeleton({ images = false }: { images?: boolean }) {
  return (
    <div
      className={`mail-body-skeleton ${images ? "images-pending" : ""}`}
      role="status"
      aria-label={images ? "正在加载图片" : "正在加载正文"}
    >
      <span className="sr-only">
        {images ? "正在加载图片…" : "正在加载正文…"}
      </span>
      {images ? (
        <Skeleton className="h-2 w-full" />
      ) : (
        <>
          <Skeleton className="mb-6 h-7 w-3/5" />
          {["w-full", "w-11/12", "w-full", "w-4/5"].map((width, i) => (
            <Skeleton key={i} className={`mb-3 h-4 ${width}`} />
          ))}
          <Skeleton className="my-6 h-40 w-full" />
          <Skeleton className="mb-3 h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </>
      )}
    </div>
  );
}
export function MailReaderSkeleton() {
  return (
    <div className="reader-skeleton" role="status" aria-label="正在加载邮件">
      <span className="sr-only">正在加载邮件…</span>
      <div className="reader-skeleton-header">
        <Skeleton className="size-10 rounded-xl" />
        <div className="flex-1">
          <Skeleton className="mb-2 h-4 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="reader-skeleton-meta">
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="h-3 w-40" />
      </div>
      <Skeleton className="mb-5 h-6 w-3/5" />
      <MailBodySkeleton />
    </div>
  );
}
export function MailListSkeleton() {
  return (
    <div role="status" aria-label="正在打开你的邮件">
      <span className="sr-only">正在打开你的邮件…</span>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="mail-row-skeleton">
          <div className="flex justify-between gap-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="mt-3 h-4 w-4/5" />
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-3 h-3 w-20" />
        </div>
      ))}
    </div>
  );
}
