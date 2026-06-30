import { MenuDropdown } from './MenuDropdown';

interface FileMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
}

export function FileMenu({ open, onOpenChange, onNew, onOpen, onSave, onSaveAs }: FileMenuProps) {
  const items: { label: string; action: () => void }[] = [
    { label: 'New', action: onNew },
    { label: 'Open…', action: onOpen },
    { label: 'Save', action: onSave },
    { label: 'Save As…', action: onSaveAs },
  ];

  return (
    <MenuDropdown label="File" open={open} onOpenChange={onOpenChange}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className="block w-full text-left px-3 py-1.5 text-sm hover:bg-white/5"
          onClick={() => {
            onOpenChange(false);
            item.action();
          }}
        >
          {item.label}
        </button>
      ))}
    </MenuDropdown>
  );
}
