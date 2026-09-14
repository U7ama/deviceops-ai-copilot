import type { Metadata } from 'next';
import React from 'react';
import Link from 'next/link';
import './globals.css';
import { ThemeToggle } from './components/ThemeToggle';
import { ToastProvider } from './components/Toast';

export const metadata: Metadata = {
  title: 'DeviceOps — Operations & Incident Resolution',
  description: 'Evidence-backed operations, multi-specialist incident investigation, and verified recovery.',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: '32x32' }
    ],
    apple: '/apple-touch-icon.png'
  }
};

const themeScript = `(function(){try{var p=localStorage.getItem('deviceops-theme')||'system';if(!['light','dark','system'].includes(p))p='system';var d=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;var t=p==='system'?(d?'dark':'light'):p;document.documentElement.setAttribute('data-theme',t);document.documentElement.setAttribute('data-theme-preference',p);document.documentElement.style.colorScheme=t;}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
    <ToastProvider>
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <Link className="brand-logo" href="/">DeviceOps</Link>
          <span className="brand-sep" aria-hidden="true">/</span>
          <Link className="brand-section" href="/operations">Operations workspace</Link>
        </div>
        <ThemeToggle />
      </div>
    </header>
    <main className="shell">{children}</main>
    </ToastProvider>
  </body></html>
  );
}

