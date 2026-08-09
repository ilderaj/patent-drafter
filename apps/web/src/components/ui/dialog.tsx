import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, ...props }: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dialog-overlay" />
      <DialogPrimitive.Content className={cn("dialog-content", className)} {...props}>
        {children}
        <DialogPrimitive.Close aria-label="关闭" className="dialog-close">
          <X size={16} />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}

export function DialogTitle(props: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className="dialog-title" {...props} />;
}

export function DialogDescription(props: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className="dialog-description" {...props} />;
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("dialog-footer", className)} {...props} />;
}
