import type { Metadata } from 'next';
import React from 'react';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'DeviceOps — Operations & Incident Resolution',
  description: 'Evidence-backed operations, multi-specialist incident investigation, and verified recovery.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>
    <header className="topbar"><Link className="brand" href="/">DeviceOps <span>Autonomous Operations</span></Link><nav aria-label="Primary navigation"><Link href="/operations">Operations</Link><Link href="/">Workspace</Link><Link href="/approvals">Approvals</Link><Link href="/incidents">Incidents</Link><Link href="/evaluations">Evaluations</Link></nav></header>
    <main className="shell">{children}</main>
    {/* <footer>Source available for portfolio review; all rights reserved; no permission to reuse or redistribute.</footer> */}
  </body></html>;
}
