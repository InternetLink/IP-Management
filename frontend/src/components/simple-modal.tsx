"use client";

import type {ReactNode} from "react";

/** Simple overlay modal — avoids HeroUI Modal compound component issues. */
export function SimpleModal({isOpen, onClose, title, children, footer}: {isOpen: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode}) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="bg-background relative z-10 w-full max-w-lg rounded-2xl border shadow-2xl mx-4">
        <div className="border-b px-6 py-4">
          <h2 className="text-foreground text-lg font-semibold">{title}</h2>
        </div>
        <div className="px-6 py-4 flex flex-col gap-3">{children}</div>
        {footer && <div className="border-t px-6 py-4 flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
