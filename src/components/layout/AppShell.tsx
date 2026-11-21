import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Navbar } from './Navbar';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { useSchool } from '../../contexts/SchoolContext';
import { getPageIdFromPath, getPageTitleFromPath } from '../../routes/routes';

interface AppShellProps {
  currentPage?: string;
  onNavigate: (page: string) => void;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  currentPage,
  onNavigate,
  children,
}) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const location = useLocation();
  const { settings } = useSchool();

  const resolvedPage = currentPage || getPageIdFromPath(location.pathname);
  const pageTitle = getPageTitleFromPath(location.pathname);

  useEffect(() => {
    const schoolTitle = settings.schoolName || 'EduKonnect Portal';
    document.title = `${pageTitle} | ${schoolTitle}`;
  }, [pageTitle, settings.schoolName]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col antialiased">
      {/* Sidebar for Desktop & Off-canvas for Mobile */}
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        currentPage={resolvedPage}
        onNavigate={onNavigate}
      />

      {/* Main Content Area */}
      <div className="md:pl-64 flex flex-col flex-1 pb-16 md:pb-0">
        <Navbar
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          currentPageTitle={pageTitle}
          onNavigate={onNavigate}
        />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <BottomNav currentPage={resolvedPage} onNavigate={onNavigate} />
    </div>
  );
};
