'use client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from './components/Toast';

type User = {
  email: string;
  displayName: string;
  tenantName: string;
  role: string;
  demoMode: boolean;
};

export default function HomePage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/v1/auth/me').then(async (response) => {
      if (!response.ok) return;
      const body = await response.json();
      setUser(body.user);
    }).catch(() => undefined).finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    if (user) router.replace('/operations');
  }, [user, router]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: window.location.origin },
        body: JSON.stringify({ email, password, client: 'web' })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? 'Login failed');
      setPassword('');
      showToast('success', 'Authenticated. Device status is server-authorized.');
      router.replace('/operations');
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Login failed';
      setMessage(errMsg);
      showToast('error', errMsg);
    } finally {
      setBusy(false);
    }
  }

  if (authLoading || user) {
    return <section className="panel ops-empty" aria-busy="true" style={{ maxWidth: 420, margin: '48px auto', textAlign: 'center' }}>{user ? 'Opening your operations workspace…' : 'Connecting to workspace…'}</section>;
  }

  return <section className="auth-card">
    <div className="eyebrow">Enterprise Infrastructure Operations · DeviceOps</div>
    <h2>Sign in to DeviceOps</h2>
    <p className="muted">Sign in to access tenant-scoped diagnostics, cited manual retrieval, and policy-constrained device operations.</p>
    <form onSubmit={login} className="stack">
      <label>Email<Input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="username" required /></label>
      <label>Password<Input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required /></label>
      <Button disabled={busy} type="submit">{busy ? 'Signing in…' : 'Sign in'}</Button>
    </form>
    {message && <p className="notice">{message}</p>}
  </section>;
}
