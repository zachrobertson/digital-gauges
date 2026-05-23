/// <reference types="vite/client" />

import type { DigitalGaugesApi } from '@shared/types';

declare global {
  interface Window {
    api: DigitalGaugesApi;
  }
}

export {};
