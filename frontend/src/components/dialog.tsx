"use client";

import type {ReactNode} from "react";

import {Modal} from "@heroui/react";

export type DialogSize = "xs" | "sm" | "md" | "lg";

export interface DialogProps {
  /** Whether the dialog is currently visible. */
  isOpen: boolean;
  /** Called when the dialog requests to close (Escape, backdrop press, or dismiss button). */
  onClose: () => void;
  /** Accessible dialog title, rendered as the dialog's labelling heading. */
  title: string;
  /** Optional supporting copy rendered directly under the title. */
  descriptionText?: ReactNode;
  /** Dialog body content — typically form fields or confirmation copy. */
  children: ReactNode;
  /** Optional action row rendered in the dialog footer. */
  footer?: ReactNode;
  /**
   * Dialog width. Defaults to `lg` (max-w-lg), matching the width the previous
   * hand-rolled overlay used so migrated forms keep their existing layout.
   */
  size?: DialogSize;
}

/**
 * Application dialog built on the installed `@heroui/react` Modal compound component.
 *
 * Mounting `Modal.Backdrop` directly (instead of `Modal.Root`) keeps the boolean
 * `isOpen`/`onClose` prop shape used across the app: `Modal.Root` is a
 * react-aria `DialogTrigger` and requires a pressable child, which none of our
 * call sites have because they open dialogs from row actions and toolbars.
 * `Modal.Backdrop` is a react-aria `ModalOverlay`, so it accepts controlled
 * `isOpen`/`onOpenChange` on its own and still provides the full overlay
 * behaviour: portal + focus scope with `contain` and `restoreFocus`, initial
 * focus on the dialog, Escape-to-close, `usePreventScroll` scroll lock, and
 * `aria-labelledby` wiring from `Modal.Heading` (rendered with `slot="title"`).
 *
 * `aria-modal` is applied through the react-aria-components `render` prop rather
 * than as a plain attribute: `Dialog` funnels incoming props through
 * `filterDOMProps`, whose allowlist covers only the labelling ARIA attributes, so
 * a pass-through `aria-modal` never reaches the DOM. React Aria omits the
 * attribute by default because of a Safari-inside-iframe focus bug and relies on
 * `ariaHideOutside` alone. This app never renders the dialog inside an iframe, so
 * declaring the modal relationship explicitly is safe and gives assistive
 * technology both signals.
 */
export function Dialog({
  children,
  descriptionText,
  footer,
  isOpen,
  onClose,
  size = "lg",
  title,
}: DialogProps) {
  return (
    <Modal.Backdrop
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Container size={size}>
        <Modal.Dialog
          render={(dialogDomProps) => (
            // `role` is declared ahead of the spread purely so static a11y tooling
            // can resolve it; react-aria's own `role` inside `dialogDomProps` still
            // wins at runtime.
            <section role="dialog" {...dialogDomProps} aria-modal="true" />
          )}
        >
          <Modal.Header>
            <Modal.Heading>{title}</Modal.Heading>
            {descriptionText ? <p className="text-muted text-sm">{descriptionText}</p> : null}
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-3">{children}</Modal.Body>
          {footer ? <Modal.Footer>{footer}</Modal.Footer> : null}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
