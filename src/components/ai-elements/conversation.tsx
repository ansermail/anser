import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { ArrowDown } from "lucide-react";
import { observeScrollFade } from "@/lib/scroll-fade";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type ConversationContextValue = {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  isAtBottom: boolean;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
};

const ConversationContext = createContext<ConversationContextValue | null>(
  null,
);

export function Conversation({
  className,
  autoScrollKey,
  children,
  ...props
}: ComponentProps<"div"> & {
  /** Changes when new messages or status updates arrive to keep bottom pinned unless user scrolled up. */
  autoScrollKey?: string | number;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const measure = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.clientHeight - el.scrollTop;
    const atBottom = distance <= 20;
    stickRef.current = atBottom;
    setIsAtBottom(atBottom);
  }, []);

  const scrollToBottom = useCallback((behavior?: ScrollBehavior) => {
    const el = viewportRef.current;
    if (!el) return;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const mode = behavior ?? (reduced ? "auto" : "smooth");
    el.scrollTo({ top: el.scrollHeight, behavior: mode });
    stickRef.current = true;
    setIsAtBottom(true);
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const stopFade = observeScrollFade(el, "vertical");
    el.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => {
      stopFade();
      el.removeEventListener("scroll", measure);
    };
  }, [measure]);

  useEffect(() => {
    if (stickRef.current) {
      const el = viewportRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
    }
    measure();
  }, [autoScrollKey, measure]);

  const value = useMemo(
    () => ({ viewportRef, isAtBottom, scrollToBottom }),
    [isAtBottom, scrollToBottom],
  );

  return (
    <ConversationContext.Provider value={value}>
      <div
        data-slot="ai-conversation"
        className={cn("relative flex min-h-0 flex-1 flex-col", className)}
        {...props}
      >
        {children}
      </div>
    </ConversationContext.Provider>
  );
}

export function ConversationContent({
  className,
  children,
  ...props
}: ComponentProps<"div">) {
  const ctx = useContext(ConversationContext);
  return (
    <div
      ref={ctx?.viewportRef}
      data-slot="ai-conversation-viewport"
      className="compose-repair-conversation"
    >
      <div
        data-slot="ai-conversation-content"
        role="log"
        className={cn("flex flex-col gap-3 px-4 py-4", className)}
        {...props}
      >
        {children}
      </div>
    </div>
  );
}

export function ConversationEmptyState({
  className,
  icon,
  title,
  description,
  children,
  ...props
}: ComponentProps<"div"> & {
  icon?: ReactNode;
  title?: string;
  description?: string;
}) {
  return (
    <div
      data-slot="ai-conversation-empty"
      className={cn(
        "flex flex-col gap-1.5 text-muted-foreground leading-relaxed",
        className,
      )}
      {...props}
    >
      {icon}
      {title && (
        <p className="font-medium text-foreground text-balance">{title}</p>
      )}
      {description && <p className="text-pretty">{description}</p>}
      {children}
    </div>
  );
}

export function ConversationScrollButton({
  className,
  label,
}: {
  className?: string;
  label: string;
}) {
  const ctx = useContext(ConversationContext);
  if (!ctx || ctx.isAtBottom) return null;
  return (
    <Button
      type="button"
      size="icon-xs"
      variant="secondary"
      data-slot="ai-conversation-scroll-button"
      className={cn(
        "absolute right-3 bottom-2 z-10 rounded-full shadow-panel",
        className,
      )}
      aria-label={label}
      onClick={() => ctx.scrollToBottom()}
    >
      <ArrowDown className="size-3.5" aria-hidden />
    </Button>
  );
}
