'use client';

import { useEffect } from 'react';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', padding: '24px', backgroundColor: '#0f172a', color: '#f8fafc' }}>
      <div style={{ maxWidth: '400px', width: '100%', padding: '24px', backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155' }}>
        <h2 style={{ marginTop: 0, color: '#f8fafc' }}>Something went wrong!</h2>
        <p style={{ color: '#94a3b8', marginBottom: '24px', wordBreak: 'break-word' }}>{error.message || 'An unexpected error occurred.'}</p>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button 
            onClick={() => reset()} 
            style={{ backgroundColor: '#38bdf8', color: '#0f172a', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', fontWeight: '500' }}
          >
            Try again
          </button>
          <a 
            href="/" 
            style={{ color: '#38bdf8', textDecoration: 'none', padding: '8px 16px', border: '1px solid #38bdf8', borderRadius: '4px', display: 'inline-block', fontWeight: '500' }}
          >
            Back to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
