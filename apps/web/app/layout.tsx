import type { Metadata } from 'next';
import React from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'DeviceOps — Incident Operations',
  description: 'Evidence-backed AV and IoT incident investigation, approval, and recovery verification.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>
    <header className="topbar"><a className="brand" href="/">DeviceOps <span>AI Copilot</span></a><nav aria-label="Primary navigation"><a href="/operations">Operations</a><a href="/">Workspace</a><a href="/approvals">Approvals</a><a href="/incidents">Incidents</a><a href="/evaluations">Evaluations</a></nav></header>
    <main className="shell">{children}</main>
    {/* <footer>Source available for portfolio review; all rights reserved; no permission to reuse or redistribute.</footer> */}
  </body></html>;
}
