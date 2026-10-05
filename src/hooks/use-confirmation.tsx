import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

interface Confirmation {
  title: string;
  description: string;
  action?: string;
  destructive?: boolean;
}
// A business composition of shadcn: cancellation/unmount resolves false.
export function useConfirmation() {
  const [request, setRequest] = useState<Confirmation | null>(null);
  const pending = useRef<((accepted: boolean) => void) | null>(null);
  const askConfirmation = useCallback(
    (value: Confirmation): Promise<boolean> => {
      pending.current?.(false);
      setRequest(value);
      return new Promise((resolve) => {
        pending.current = resolve;
      });
    },
    [],
  );
  const finish = useCallback((accepted: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    setRequest(null);
    resolve?.(accepted);
  }, []);
  const cancelConfirmation = useCallback(() => finish(false), [finish]);
  useEffect(
    () => () => {
      pending.current?.(false);
      pending.current = null;
    },
    [],
  );
  const confirmationDialog = (
    <AlertDialog
      open={!!request}
      onOpenChange={(open) => {
        if (!open) finish(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {request?.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => finish(false)}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            variant={request?.destructive ? "destructive" : "default"}
            onClick={() => finish(true)}
          >
            {request?.action || "继续"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { askConfirmation, cancelConfirmation, confirmationDialog };
}
