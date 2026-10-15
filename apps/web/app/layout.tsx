import type { Metadata } from 'next';
import React from 'react';
import { ThemeProvider } from './components/ThemeProvider';
import { PublicHeader } from './components/WorkspaceLayout';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';
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

const themeScript = `(function(){var p='system',c='vercel';try{p=localStorage.getItem('deviceops-theme')||p;c=localStorage.getItem('deviceops-palette')||c;}catch(e){}if(!['light','dark','system'].includes(p))p='system';if(!['vercel','claude','discord','supabase','mono','notebook','light-green','zen','astro-vista','whatsapp'].includes(c))c='vercel';var d=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;var t=p==='system'?(d?'dark':'light'):p;var h=document.documentElement;h.setAttribute('data-theme',t);h.setAttribute('data-theme-preference',p);h.setAttribute('data-palette',c);h.classList.toggle('dark',t==='dark');h.style.colorScheme=t;})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-palette="vercel" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ThemeProvider><TooltipProvider><ToastProvider>
          <PublicHeader />
          <div className="shell">{children}</div>
        </ToastProvider></TooltipProvider></ThemeProvider>
  </body></html>
  );
}

