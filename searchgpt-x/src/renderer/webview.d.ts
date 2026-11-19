import type { WebviewTag } from 'electron';
import type React from 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<WebviewTag>, WebviewTag> & {
        src?: string;
        partition?: string;
        allowpopups?: string;
        webpreferences?: string;
        useragent?: string;
      };
    }
  }
}
