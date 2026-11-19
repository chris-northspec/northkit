import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { PRODUCT_NAME } from '@northkit/core';
// Inter and Space Grotesk, self-hosted: the font files are built into the app and served from this
// server, never fetched from a font service (OFL-1.1, font files only; see LICENCES).
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
// Space Grotesk for page titles, the wordmark and big figures (house style, S7-11).
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '../styles/tokens.css';
import '../styles/app.css';
import '../styles/v2.css';

export const metadata: Metadata = {
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  applicationName: PRODUCT_NAME,
  // Staff-only system on the customer's own server: never indexed.
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
  // The Ink of the sidebar and the phone's top bar edge (house style).
  themeColor: '#1B1F24',
  // Lets the fixed Report a problem button sit clear of the iOS home bar.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
