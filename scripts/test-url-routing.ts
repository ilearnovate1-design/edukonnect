/**
 * Test Suite: URL Routing & Navigation Integrity
 *
 * Verifies:
 * 1. Route path constants, normalization, page ID mapping, and titles
 * 2. Query-string preservation for tab/view deep linking
 * 3. Auth-route classification (preventing post-login redirect loops)
 * 4. Unknown / malformed paths resolve consistently to 'not-found'
 * 5. Static verification of React Router adoption across entry, layout, auth, and tabbed pages
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  APP_ROUTES,
  AUTH_ROUTES,
  getPageIdFromPath,
  getPageTitleFromPath,
  getPathForPage,
  isAuthPath,
  normalizePathname,
} from '../src/routes/routes';

let passed = 0;
let failed = 0;

function assert(cond: boolean, desc: string) {
  if (cond) {
    console.log(`  ✓ PASS: ${desc}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${desc}`);
    failed++;
  }
}

console.log('--- STARTING URL ROUTING & NAVIGATION TESTS ---');

// 1. Path normalization
assert(normalizePathname('') === '/', 'Empty path normalizes to /');
assert(normalizePathname('/') === '/', 'Root path normalizes to /');
assert(normalizePathname('/students/') === '/students', 'Trailing slash removed from /students/');
assert(normalizePathname('fees') === '/fees', 'Missing leading slash added to fees');

// 2. Roundtrip APP_ROUTES & AUTH_ROUTES
for (const [pageKey, routePath] of Object.entries(APP_ROUTES)) {
  assert(getPathForPage(pageKey) === routePath, `getPathForPage("${pageKey}") -> "${routePath}"`);
  assert(getPageIdFromPath(routePath) === pageKey, `getPageIdFromPath("${routePath}") -> "${pageKey}"`);
  assert(
    getPageTitleFromPath(routePath) !== 'School Portal',
    `getPageTitleFromPath("${routePath}") returns explicit page title`
  );
}

for (const [, routePath] of Object.entries(AUTH_ROUTES)) {
  const expectedId = routePath.slice(1);
  assert(getPageIdFromPath(routePath) === expectedId, `Auth route "${routePath}" maps to "${expectedId}"`);
  assert(isAuthPath(routePath) === true, `isAuthPath("${routePath}") is true`);
}

// 3. Query-string preservation & fallback paths
assert(getPathForPage('fees?tab=debtors') === '/fees?tab=debtors', 'Preserves query params when mapping page ID');
assert(getPathForPage('/results?view=broadsheet') === '/results?view=broadsheet', 'Preserves absolute paths with query params');
assert(getPathForPage('') === '/dashboard', 'Blank navigation target defaults to /dashboard');
assert(getPageIdFromPath('/') === 'dashboard', 'Root path maps to dashboard page ID');
assert(getPageIdFromPath('/nonexistent-route') === 'not-found', 'Unknown path maps to not-found');
assert(getPageIdFromPath('/students/extra/segment') === 'not-found', 'Unknown nested path maps to not-found');
assert(getPageTitleFromPath('/unknown') === 'Page Not Found', 'Unknown path resolves to Page Not Found title');
assert(isAuthPath(APP_ROUTES.dashboard) === false, 'isAuthPath("/dashboard") is false');
assert(isAuthPath(APP_ROUTES.students) === false, 'isAuthPath("/students") is false');

// 4. Static integration checks across codebase
const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');

const mainSrc = read('src/main.tsx');
assert(mainSrc.includes('BrowserRouter'), 'src/main.tsx wraps application in BrowserRouter');

const appSrc = read('src/App.tsx');
assert(
  appSrc.includes('<Routes>') && appSrc.includes('<Route') && appSrc.includes('<Navigate'),
  'src/App.tsx renders declarative React Router <Routes>, <Route>, and <Navigate>'
);
assert(
  !appSrc.includes("useState<string>('dashboard')"),
  'src/App.tsx no longer relies on useState("dashboard") for page routing'
);
assert(
  appSrc.includes('state={{ from: location }}'),
  'src/App.tsx preserves deep-link destination across login redirect'
);

const sidebarSrc = read('src/components/layout/Sidebar.tsx');
assert(sidebarSrc.includes('NavLink'), 'Sidebar uses React Router NavLink anchors');

const bottomNavSrc = read('src/components/layout/BottomNav.tsx');
assert(bottomNavSrc.includes('NavLink'), 'BottomNav uses React Router NavLink anchors');

const navbarSrc = read('src/components/layout/Navbar.tsx');
assert(navbarSrc.includes('Link'), 'Navbar uses React Router Link anchors');

const appShellSrc = read('src/components/layout/AppShell.tsx');
assert(appShellSrc.includes('document.title'), 'AppShell synchronizes document.title with route');

const loginSrc = read('src/pages/auth/LoginPage.tsx');
assert(
  loginSrc.includes('useLocation') && loginSrc.includes('useNavigate') && loginSrc.includes('useSearchParams'),
  'LoginPage syncs auth modes and ?invite= params with React Router'
);

const teachersSrc = read('src/pages/teachers/TeachersPage.tsx');
assert(
  teachersSrc.includes('/activate?invite=') && teachersSrc.includes('useQueryTab'),
  'TeachersPage uses /activate?invite= links and URL query-synced tabs'
);

const parentsSrc = read('src/pages/parents/ParentsPage.tsx');
assert(
  parentsSrc.includes('/activate?invite=') && parentsSrc.includes('useQueryTab'),
  'ParentsPage uses /activate?invite= links and URL query-synced tabs'
);

for (const tabbedFile of [
  'src/pages/classes/ClassesPage.tsx',
  'src/pages/fees/FeesPage.tsx',
  'src/pages/audit/AuditLogsPage.tsx',
  'src/pages/superadmin/SuperAdminPage.tsx',
  'src/pages/settings/SettingsPage.tsx',
  'src/pages/results/ResultsPage.tsx',
]) {
  assert(read(tabbedFile).includes('useQueryTab'), `${tabbedFile} syncs active tab/view with URL search params`);
}

console.log(`\nURL Routing Tests Summary: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
