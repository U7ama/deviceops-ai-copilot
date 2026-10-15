'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LayoutDashboard, Siren, Network, ShieldCheck, BookOpen, Settings, Stethoscope, ClipboardList, FileCheck, CheckCircle2, LogOut, Activity, X } from 'lucide-react';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
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
  const router = useRouter();
  const { setOpenMobile, isMobile } = useSidebar();
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


  function handleViewClick(view: View) {
    if (onSelectView) onSelectView(view);
    else router.push(`/operations?view=${view}`);
    setOpenMobile(false);
  }

  return <Sidebar collapsible="icon" className="deviceops-sidebar">
    <SidebarHeader>
      <SidebarMenu><SidebarMenuItem><SidebarMenuButton size="lg" tooltip="DeviceOps" render={<Link href="/operations" />} aria-label="DeviceOps workspace">
        <span className="sidebar-logo"><Activity size={18} aria-hidden="true" /></span>
        <span className="sidebar-brand-copy"><strong>DeviceOps</strong><small>Operations workspace</small></span>
      </SidebarMenuButton></SidebarMenuItem></SidebarMenu>
      {isMobile && <Button variant="ghost" size="icon" className="drawer-close" aria-label="Close navigation" onClick={() => setOpenMobile(false)}><X size={18} /></Button>}
    </SidebarHeader>
    <SidebarContent>
      <SidebarGroup><SidebarGroupLabel>Operations Center</SidebarGroupLabel>
        <nav aria-label="Operations views"><SidebarMenu>
          {(Object.keys(viewLabels) as View[]).map(view => {
            const Icon = viewIcons[view];
            return <SidebarMenuItem key={view}><SidebarMenuButton tooltip={viewLabels[view]} aria-label={viewLabels[view]} isActive={currentView === view} aria-current={currentView === view ? 'page' : undefined} onClick={() => handleViewClick(view)}><Icon aria-hidden="true" /><span>{viewLabels[view]}</span></SidebarMenuButton></SidebarMenuItem>;
          })}
        </SidebarMenu></nav>
      </SidebarGroup>
      <SidebarGroup><SidebarGroupLabel>Specialist Tools</SidebarGroupLabel>
        <nav aria-label="Workspace tools"><SidebarMenu>{v1Tools.map(tool => {
          const Icon = tool.icon;
          return <SidebarMenuItem key={tool.href}><SidebarMenuButton tooltip={tool.label} aria-label={tool.label} isActive={currentPath === tool.href || (currentPath === '/runs' && tool.href === '/diagnosis')} render={<Link href={tool.href} />} onClick={() => setOpenMobile(false)}><Icon aria-hidden="true" /><span>{tool.label}</span></SidebarMenuButton></SidebarMenuItem>;
        })}</SidebarMenu></nav>
      </SidebarGroup>
    </SidebarContent>
    <SidebarFooter>
      <div className="sidebar-account"><span className="sidebar-avatar" aria-hidden="true">{user?.displayName?.slice(0, 1).toUpperCase() || 'D'}</span><div><strong>{user?.displayName || 'DeviceOps user'}</strong><small>{user?.tenantName || 'Workspace'} · {user?.role || 'Member'}</small></div></div>
      <SidebarMenu><SidebarMenuItem><SidebarMenuButton tooltip="Sign out" aria-label="Sign out" onClick={() => void handleLogout()}><LogOut aria-hidden="true" /><span>Sign out</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu>
    </SidebarFooter>
  </Sidebar>;
}
