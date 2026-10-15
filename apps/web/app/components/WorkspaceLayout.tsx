'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Activity } from 'lucide-react';
import { SidebarProvider, SidebarInset, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { AppSidebar, viewLabels, type AppSidebarProps } from './AppSidebar';
import { ThemeToggle } from './ThemeToggle';
import { PaletteSelector } from './PaletteSelector';
import { PageContainer } from './PageContainer';

const toolLabels: Record<string, string> = {
  '/diagnosis': 'Device diagnosis', '/incidents': 'Incident delivery log',
  '/approvals': 'Approval queue', '/evaluations': 'Evaluations', '/runs': 'Run timeline'
};

function WorkspaceHeader({ label }: { label: string }) {
  const { isMobile, openMobile, state } = useSidebar();
  return <header className="dashboard-header">
    <div className="dashboard-breadcrumb">
      <SidebarTrigger aria-label={isMobile ? `Navigation · ${label}` : 'Toggle sidebar'} aria-expanded={isMobile ? openMobile : state === 'expanded'} />
      <Separator orientation="vertical" className="h-4" />
      <nav aria-label="Breadcrumb"><Link href="/operations">Operations</Link><ChevronRight size={14} aria-hidden="true" /><span aria-current="page">{label}</span></nav>
    </div>
    <div className="dashboard-header-actions"><ThemeToggle /><PaletteSelector /></div>
  </header>;
}

export function WorkspaceLayout({ children, pageTitle, pageDescription, pageHeaderAction, ...sidebarProps }: AppSidebarProps & {
  children: ReactNode;
  pageTitle?: string;
  pageDescription?: string;
  pageHeaderAction?: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const label = sidebarProps.currentView ? viewLabels[sidebarProps.currentView] : toolLabels[sidebarProps.currentPath ?? ''] ?? 'Workspace';
  return <SidebarProvider open={open} onOpenChange={setOpen} className="deviceops-dashboard">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <AppSidebar {...sidebarProps} />
    <SidebarInset id="main-content" tabIndex={-1} className="min-w-0">
      <WorkspaceHeader label={label} />
      <div className="ops ops-content">
        <PageContainer pageTitle={pageTitle} pageDescription={pageDescription} pageHeaderAction={pageHeaderAction}>{children}</PageContainer>
      </div>
    </SidebarInset>
  </SidebarProvider>;
}

export function PublicHeader() {
  const pathname = usePathname();
  if (pathname !== '/') return null;
  return <header className="public-header"><Link href="/" className="public-brand"><Activity size={20} aria-hidden="true" />DeviceOps</Link><div className="dashboard-header-actions"><ThemeToggle /><PaletteSelector /></div></header>;
}
