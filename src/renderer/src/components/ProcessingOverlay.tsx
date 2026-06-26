interface Props {
  message: string | null;
}

export function ProcessingOverlay({ message }: Props) {
  if (!message) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm cursor-wait"
      role="alertdialog"
      aria-modal="true"
      aria-busy="true"
      aria-label={message}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="panel w-full max-w-sm p-6 flex flex-col items-center gap-4 shadow-xl">
        <span
          className="h-9 w-9 rounded-full border-2 border-white/15 border-t-accent animate-spin"
          aria-hidden="true"
        />
        <div className="text-center">
          <p className="text-sm font-medium text-white">{message}</p>
          <p className="text-xs text-white/40 mt-1">
            Please wait — this can take a moment for large files.
          </p>
        </div>
        <div className="w-full h-1 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full w-1/3 rounded-full bg-accent animate-processing-bar" />
        </div>
      </div>
    </div>
  );
}
