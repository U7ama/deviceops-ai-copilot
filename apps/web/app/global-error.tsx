'use client';

import { Button } from '@/components/ui/button';
import './globals.css';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="en" data-palette="vercel"><body>
    <section className="panel error-card" role="alert">
      <span className="eyebrow">DeviceOps</span><h2>Workspace unavailable</h2>
      <p className="muted">{error.message || 'The workspace could not be loaded.'}</p>
      <div className="ops-actions"><Button onClick={reset}>Try again</Button><a className="ops-link-button" href="/">Back to sign in</a></div>
    </section>
  </body></html>;
}
