'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <section className="panel error-card" role="alert">
    <span className="eyebrow">DeviceOps</span><h2>Something went wrong</h2>
    <p className="muted">{error.message || 'An unexpected error occurred.'}</p>
    <div className="ops-actions"><Button onClick={reset}>Try again</Button><Button variant="outline" render={<Link href="/operations" />}>Back to dashboard</Button></div>
  </section>;
}
