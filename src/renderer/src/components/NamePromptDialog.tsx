import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  open: boolean;
  title: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  dismissOnBackdropClick?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function NamePromptDialog({
  open,
  title,
  label = 'Name',
  placeholder,
  defaultValue = '',
  confirmLabel = 'Save',
  dismissOnBackdropClick = true,
  onConfirm,
  onCancel,
}: Props) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      const id = window.setTimeout(() => {
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        input.select();
      }, 0);
      return () => window.clearTimeout(id);
    }
  }, [open, defaultValue]);

  if (!open) return null;

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60"
      onClick={dismissOnBackdropClick ? onCancel : undefined}
      onPointerDown={(e) => e.stopPropagation()}
      role="presentation"
    >
      <div
        className="panel w-full max-w-sm p-5 flex flex-col gap-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-prompt-title"
      >
        <h2 id="name-prompt-title" className="text-base font-semibold">
          {title}
        </h2>
        <div className="flex flex-col gap-1.5">
          <label className="field-label" htmlFor="name-prompt-input">{label}</label>
          <input
            id="name-prompt-input"
            ref={inputRef}
            type="text"
            autoFocus
            className="bg-white/5 rounded-md px-3 py-2 text-sm border border-white/10 text-white caret-white"
            placeholder={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') onCancel();
            }}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!value.trim()}
            onClick={submit}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
