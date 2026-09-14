'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Siren,
  Network,
  ShieldCheck,
  BookOpen,
  Settings,
  Stethoscope,
  ClipboardList,
  FileCheck,
  CheckCircle2,
  LogOut,
  ChevronRight
} from 'lucide-react';
import { useToast } from './Toast';

export type View = 'overview' | 'incidents' | 'fleet' | 'approvals' | 'knowledge' | 'admin';

export const viewLabels: Record<View, string> = {
  overview: 'Overview',
  incidents: 'Incidents',
  fleet: 'Rooms & Equipment',
  approvals: 'Approvals',
  knowledge: 'Knowledge',
  admin: 'Administration'
};

const viewIcons: Record<View, React.ComponentType<{ size?: number; className?: string }>> = {
  overview: LayoutDashboard,
  incidents: Siren,
  fleet: Network,
  approvals: ShieldCheck,
  knowledge: BookOpen,
  admin: Settings
};

const v1Tools = [
  { href: '/diagnosis', label: 'Device diagnosis', icon: Stethoscope },
  { href: '/incidents', label: 'Incident delivery log', icon: ClipboardList },
  { href: '/approvals', label: 'Approval queue', icon: FileCheck },
  { href: '/evaluations', label: 'Evaluations', icon: CheckCircle2 }
];

export interface AppSidebarProps {
  currentView?: View;
  currentPath?: string;
  onSelectView?: (view: View) => void;
  user?: {
    tenantName?: string;
    displayName?: string;
    role?: string;
  } | null;
}

export function AppSidebar({ currentView, currentPath, onSelectView, user }: AppSidebarProps) {
  const [mobileNav, setMobileNav] = useState(false);
  const router = useRouter();
  const { showToast } = useToast();

  async function handleLogout() {
    try {
      const csrfCookie = document.cookie.split('; ').find(p => p.startsWith('deviceops_csrf='));
      const csrf = csrfCookie ? decodeURIComponent(csrfCookie.slice('deviceops_csrf='.length)) : '';
      const response = await fetch('/api/v1/auth/logout', {
        method: 'POST',
        headers: {
          origin: window.location.origin,
          'x-csrf-token': csrf
        }
      });
      if (!response.ok) throw new Error('Sign out failed');
      showToast('success', 'Signed out of DeviceOps.');
      window.location.href = '/';
    } catch {
      showToast('error', 'Sign out failed.');
    }
  }

  function handleViewClick(v: View) {
    if (onSelectView) {
      onSelectView(v);
    } else {
      router.push(`/operations?view=${v}`);
    }
    setMobileNav(false);
  }

  const activeLabel = currentView ? viewLabels[currentView] : (v1Tools.find(t => t.href === currentPath)?.label ?? 'Operations');

  return (
    <aside className={`ops-sidebar ${mobileNav ? 'is-open' : ''}`}>
      <button
        type="button"
        className="ops-mobile-menu"
        aria-expanded={mobileNav}
        aria-controls="ops-navigation"
        onClick={() => setMobileNav(!mobileNav)}
      >
        Navigation · {activeLabel}
      </button>

      <div className="ops-sidebar-context">
        <div className="ops-sidebar-tenant-badge">
          <strong>{user?.tenantName || 'Apex Infrastructure Operations'}</strong>
          <small>{user?.displayName || 'Technician'} · {user?.role || 'manager'}</small>
        </div>
      </div>

      <div className="ops-sidebar-section-header">
        <span>Operations Center</span>
      </div>

      <nav id="ops-navigation" aria-label="Operations views">
        {(Object.keys(viewLabels) as View[]).map((v) => {
          const Icon = viewIcons[v];
          const isSelected = currentView === v;
          return (
            <button
              type="button"
              key={v}
              className={`ops-nav-button ${isSelected ? 'is-active' : ''}`}
              aria-current={isSelected ? 'page' : undefined}
              onClick={() => handleViewClick(v)}
            >
              <Icon size={18} className="ops-nav-icon" aria-hidden="true" />
              <span className="ops-nav-label">{viewLabels[v]}</span>
              {isSelected && <ChevronRight size={14} className="ops-nav-chevron" aria-hidden="true" />}
            </button>
          );
        })}
      </nav>

      <div className="ops-sidebar-divider" aria-hidden="true" />

      <div className="ops-sidebar-section-header">
        <span>Specialist Tools</span>
      </div>

      <nav aria-label="Workspace tools" className="ops-sidebar-tools">
        {v1Tools.map((tool) => {
          const Icon = tool.icon;
          const isSelected = currentPath === tool.href;
          return (
            <Link
              key={tool.href}
              href={tool.href}
              className={`ops-tool-link ${isSelected ? 'is-active' : ''}`}
              aria-current={isSelected ? 'page' : undefined}
            >
              <Icon size={18} className="ops-nav-icon" aria-hidden="true" />
              <span className="ops-nav-label">{tool.label}</span>
              {isSelected && <ChevronRight size={14} className="ops-nav-chevron" aria-hidden="true" />}
            </Link>
          );
        })}

        <button
          type="button"
          onClick={handleLogout}
          className="ops-tool-link ops-signout-link"
        >
          <LogOut size={18} className="ops-nav-icon" aria-hidden="true" />
          <span className="ops-nav-label">Sign out</span>
        </button>
      </nav>
    </aside>
  );
}
