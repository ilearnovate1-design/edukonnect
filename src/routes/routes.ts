export const APP_ROUTES = {
  dashboard: '/dashboard',
  students: '/students',
  parents: '/parents',
  teachers: '/teachers',
  classes: '/classes',
  attendance: '/attendance',
  fees: '/fees',
  results: '/results',
  assignments: '/assignments',
  announcements: '/announcements',
  settings: '/settings',
  audit: '/audit',
  setup: '/setup',
  superadmin: '/superadmin',
  usage: '/usage',
} as const;

export type AppPageId = keyof typeof APP_ROUTES;

export const AUTH_ROUTES = {
  login: '/login',
  registerSchool: '/register-school',
  activate: '/activate',
  awaitingApproval: '/awaiting-approval',
  accessDenied: '/access-denied',
  membershipRequired: '/membership-required',
} as const;

export const PAGE_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  students: 'Students',
  parents: 'Parents',
  teachers: 'Teachers',
  classes: 'Classes & Subjects',
  attendance: 'Daily Attendance',
  fees: 'Fees & Payments',
  results: 'Examination Results',
  assignments: 'Assignments',
  announcements: 'Announcements',
  settings: 'School Settings',
  audit: 'Audit Logs & Security',
  setup: 'School Setup',
  superadmin: 'System Admin',
  usage: 'Usage & Cost Monitoring',
  login: 'Sign In',
  'register-school': 'Register Your School',
  activate: 'Activate Invitation',
  'awaiting-approval': 'Registration Pending',
  'access-denied': 'Access Denied',
  'membership-required': 'School Membership Required',
  'not-found': 'Page Not Found',
};

const ROUTE_TO_PAGE_ID: Record<string, string> = {
  '/': 'dashboard',
  '/dashboard': 'dashboard',
  '/students': 'students',
  '/parents': 'parents',
  '/teachers': 'teachers',
  '/classes': 'classes',
  '/attendance': 'attendance',
  '/fees': 'fees',
  '/results': 'results',
  '/assignments': 'assignments',
  '/announcements': 'announcements',
  '/settings': 'settings',
  '/audit': 'audit',
  '/setup': 'setup',
  '/superadmin': 'superadmin',
  '/usage': 'usage',
  '/login': 'login',
  '/register-school': 'register-school',
  '/activate': 'activate',
  '/awaiting-approval': 'awaiting-approval',
  '/access-denied': 'access-denied',
  '/membership-required': 'membership-required',
};

export function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  const cleaned = pathname.replace(/\/+$/, '');
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
}

export function getPathForPage(pageOrPath: string): string {
  const trimmed = (pageOrPath || '').trim();
  if (!trimmed) return APP_ROUTES.dashboard;
  if (trimmed.startsWith('/')) {
    return trimmed;
  }

  const [rawId, query] = trimmed.split('?');
  const mappedPath =
    (APP_ROUTES as Record<string, string>)[rawId] ||
    (AUTH_ROUTES as Record<string, string>)[rawId] ||
    `/${rawId.replace(/^\/+/, '')}`;

  return query ? `${mappedPath}?${query}` : mappedPath;
}

export function getPageIdFromPath(pathname: string): string {
  const normalized = normalizePathname(pathname);
  if (ROUTE_TO_PAGE_ID[normalized]) {
    return ROUTE_TO_PAGE_ID[normalized];
  }
  return 'not-found';
}

export function getPageTitleFromPath(pathname: string): string {
  const pageId = getPageIdFromPath(pathname);
  return PAGE_TITLES[pageId] || 'School Portal';
}

export function isAuthPath(pathname: string): boolean {
  const normalized = normalizePathname(pathname);
  return (
    normalized === AUTH_ROUTES.login ||
    normalized === AUTH_ROUTES.registerSchool ||
    normalized === AUTH_ROUTES.activate ||
    normalized === AUTH_ROUTES.awaitingApproval ||
    normalized === AUTH_ROUTES.accessDenied ||
    normalized === AUTH_ROUTES.membershipRequired
  );
}
