import { useEffect, useRef, useState } from 'react';

interface Props {
  open: boolean;
  title: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
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
  onConfirm,
  onCancel,
}: Props) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open, defaultValue]);

  if (!open) return null;

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="panel w-full max-w-sm p-5 flex flex-col gap-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-prompt-title"
      >
        <h2 id="name-prompt-title" className="text-base font-semibold">
          {title}
        </h2>
        <div className="flex flex-col gap-1.5">
          <label className="field-label">{label}</label>
          <input
            ref={inputRef}
            type="text"
            className="bg-white/5 rounded-md px-3 py-2 text-sm border border-white/10"
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
    </div>
  );
}
