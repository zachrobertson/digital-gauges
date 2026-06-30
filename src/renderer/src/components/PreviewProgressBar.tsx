import type { PreviewProgress } from '@shared/types';

interface Props {
  progress: PreviewProgress;
  compact?: boolean;
}

export function PreviewProgressBar({ progress, compact = false }: Props) {
  return (
    <div
      className={compact ? 'flex flex-col gap-1 min-w-[160px]' : 'flex flex-col gap-2 w-full max-w-sm'}
      aria-busy="true"
      aria-label={progress.message}
    >
      <p className={`text-center text-white/70 truncate ${compact ? 'text-xs' : 'text-sm'}`}>
        {progress.message}
      </p>
      <div className={`rounded-full bg-white/10 overflow-hidden ${compact ? 'h-1' : 'h-1.5'}`}>
        <div className="h-full w-1/3 rounded-full bg-accent animate-processing-bar" />
      </div>
    </div>
  );
}
