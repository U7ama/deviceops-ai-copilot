import Link from 'next/link';

export default function NotFound() {
  return <section className="panel error-card"><span className="eyebrow">DeviceOps · 404</span><h2>Page not found</h2><p className="muted">This address does not point to a DeviceOps page.</p><Link className="ops-link-button" href="/operations">Back to operations</Link></section>;
}
