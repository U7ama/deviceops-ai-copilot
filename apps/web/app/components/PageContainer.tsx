import type { ReactNode } from 'react';

interface PageContainerProps {
  children: ReactNode;
  pageTitle?: string | undefined;
  pageDescription?: string | undefined;
  pageHeaderAction?: ReactNode;
}

export function PageContainer({ children, pageTitle, pageDescription, pageHeaderAction }: PageContainerProps) {
  return <div className="dashboard-page">
    {(pageTitle || pageHeaderAction) && <div className="dashboard-page-heading">
      <div>{pageTitle && <h1>{pageTitle}</h1>}{pageDescription && <p>{pageDescription}</p>}</div>
      {pageHeaderAction && <div className="dashboard-page-actions">{pageHeaderAction}</div>}
    </div>}
    {children}
  </div>;
}
