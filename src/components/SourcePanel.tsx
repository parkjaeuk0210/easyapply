"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Native modal on small screens; a persistent side panel on desktop. */
export default function SourcePanel({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const [mobile, setMobile] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pressedOutside = useRef(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open, mobile]);

  if (!mobile) return <aside aria-label="공고문 원문" className="sticky top-[76px] h-[calc(100dvh-92px)] overflow-hidden rounded-2xl">{children}</aside>;

  const outside = (event: React.PointerEvent<HTMLDialogElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  };
  return <dialog ref={dialogRef} aria-label="공고문 원문" onClose={onClose}
    onPointerDown={event => { pressedOutside.current = outside(event); }}
    onPointerUp={event => { if (pressedOutside.current && outside(event)) event.currentTarget.close(); pressedOutside.current = false; }}
    className="source-dialog fixed inset-x-0 bottom-0 top-auto m-0 h-[88dvh] max-h-none w-full max-w-none overflow-hidden rounded-t-2xl border-0 p-0 shadow-2xl backdrop:bg-ink/40">
    {children}
  </dialog>;
}
