import type { Metadata } from 'next';
import React from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'DeviceOps AI Copilot',
  description: 'Production-ready Applied AI reference implementation for synthetic device operations data.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>
    <header className="topbar"><a className="brand" href="/">DeviceOps <span>AI Copilot</span></a><nav aria-label="Primary navigation"><a href="/">Workspace</a><a href="/approvals">Approvals</a><a href="/incidents">Incidents</a><a href="/evaluations">Evaluations</a></nav></header>
    <main className="shell">{children}</main>
    <footer>Source available for portfolio review; all rights reserved; no permission to reuse or redistribute.</footer>
  </body></html>;
}
