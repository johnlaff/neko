import { type ReactNode, useEffect, useRef } from "react";
import { IconClose } from "./icons.tsx";

/**
 * A decision about one thing, over the screen it came from: a sheet from the bottom on a phone, a
 * drawer from the right on a wide screen (as Monarch opens a transaction). The native dialog keeps
 * the focus inside, Esc closes it, and a tap outside does too. What it holds mounts on each open,
 * so a half-made choice never survives a close.
 */
export const Sheet = ({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  /** Read out when it opens, and shown on top beside the close button. */
  title: string;
  onClose: () => void;
  children: ReactNode;
}) => {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc closes it natively; the click is the backdrop's.
    <dialog
      ref={ref}
      className="sheet"
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        // The backdrop is the dialog itself, and so is the sheet's empty space around its body: only
        // a tap outside the sheet's box closes it, so a half-made choice is never lost to a stray tap.
        if (e.target !== e.currentTarget) return;
        const box = e.currentTarget.getBoundingClientRect();
        const inside =
          e.clientX >= box.left &&
          e.clientX <= box.right &&
          e.clientY >= box.top &&
          e.clientY <= box.bottom;
        if (!inside) onClose();
      }}
    >
      {open && (
        <div className="sheet-body">
          <div className="sheet-head">
            <h2>{title}</h2>
            <button type="button" className="icon" aria-label="Fechar" onClick={onClose}>
              <IconClose />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
};
