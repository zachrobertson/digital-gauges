import { useCallback, useRef, useState } from 'react';

export interface NamePromptOptions {
  title: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
}

interface PromptState extends NamePromptOptions {
  open: boolean;
}

const CLOSED: PromptState = { open: false, title: '' };

export function useNamePrompt() {
  const [state, setState] = useState<PromptState>(CLOSED);
  const resolveRef = useRef<((value: string | null) => void) | null>(null);

  const prompt = useCallback((options: NamePromptOptions) => {
    return new Promise<string | null>((resolve) => {
      resolveRef.current = resolve;
      setState({ ...options, open: true });
    });
  }, []);

  const close = useCallback((value: string | null) => {
    setState(CLOSED);
    resolveRef.current?.(value);
    resolveRef.current = null;
  }, []);

  return { state, prompt, close };
}
