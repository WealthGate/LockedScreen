/// <reference types="vite/client" />

import type { LockedscreenApi } from "../preload";

declare global {
  interface Window {
    lockedscreenApi: LockedscreenApi;
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: any;
    }
  }
}

export {};
