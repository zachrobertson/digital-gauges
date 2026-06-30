import { useEffect, useRef, type ReactNode } from 'react';

interface MenuDropdownProps {
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Extra classes for the dropdown panel (e.g. width). */
  panelClassName?: string;
  children: ReactNode;
}

/**
 * App menu-bar dropdown (File / Settings). Controlled `open` state so the parent
 * can enforce a single open menu at a time. Dismisses on outside pointerdown.
 */
export function MenuDropdown({ label, open, onOpenChange, panelClassName, children }: MenuDropdownProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={`menubar-trigger ${open ? 'bg-bg-hover text-white' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        {label}
        <span className="ml-1 text-[9px] text-textfaint">▾</span>
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute top-full left-0 mt-1 z-50 panel shadow-lg py-1 ${panelClassName ?? 'w-44'}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
