import React, { Suspense, lazy, useEffect } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { Compass } from 'lucide-react';
import { AppErrorBoundary } from './components/ErrorBoundary';

// Route-level code splitting: mobile visitors only download the exact screen they open!
const LandingPage = lazy(() =>
  import('./pages/LandingPage').then((m) => ({ default: m.LandingPage })),
);
const VenuesPage = lazy(() =>
  import('./pages/VenuesPage').then((m) => ({ default: m.VenuesPage })),
);
const VenuePage = lazy(() =>
  import('./pages/VenuePage').then((m) => ({ default: m.VenuePage })),
);
const RoutePage = lazy(() =>
  import('./pages/RoutePage').then((m) => ({ default: m.RoutePage })),
);
const PeoplePage = lazy(() =>
  import('./pages/PeoplePage').then((m) => ({ default: m.PeoplePage })),
);
const AdminLoginPage = lazy(() =>
  import('./pages/admin/AdminLoginPage').then((m) => ({ default: m.AdminLoginPage })),
);
const AdminLayout = lazy(() =>
  import('./pages/admin/AdminLayout').then((m) => ({ default: m.AdminLayout })),
);
const AdminOverviewPage = lazy(() =>
  import('./pages/admin/AdminOverviewPage').then((m) => ({ default: m.AdminOverviewPage })),
);
const AdminDatasetPage = lazy(() =>
  import('./pages/admin/AdminDatasetPage').then((m) => ({ default: m.AdminDatasetPage })),
);
const AdminPeoplePage = lazy(() =>
  import('./pages/admin/AdminPeoplePage').then((m) => ({ default: m.AdminPeoplePage })),
);
const AdminClosuresPage = lazy(() =>
  import('./pages/admin/AdminClosuresPage').then((m) => ({ default: m.AdminClosuresPage })),
);
const AdminMapBuilderPage = lazy(() =>
  import('./pages/admin/AdminMapBuilderPage').then((m) => ({ default: m.AdminMapBuilderPage })),
);
const AdminProfilePage = lazy(() =>
  import('./pages/admin/AdminProfilePage').then((m) => ({ default: m.AdminProfilePage })),
);

const ScrollToTop: React.FC = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname]);
  return null;
};

const PageRouteFallback: React.FC = () => (
  <div className="min-h-[100dvh] w-full bg-[#070B18] flex flex-col items-center justify-center gap-3 text-white px-4">
    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-indigo-600 shadow-lg shadow-cyan-500/20">
      <Compass className="h-5 w-5 animate-spin" style={{ animationDuration: '2.2s' }} />
    </div>
    <p className="text-xs font-semibold tracking-wide text-slate-300">
      Loading Navigator...
    </p>
  </div>
);

const App: React.FC = () => {
  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <ScrollToTop />
        <Suspense fallback={<PageRouteFallback />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/venues" element={<VenuesPage />} />
            <Route path="/v/:slug" element={<VenuePage />} />
            <Route path="/v/:slug/route" element={<RoutePage />} />
            <Route path="/v/:slug/people" element={<PeoplePage />} />

            <Route path="/admin/login" element={<AdminLoginPage />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminOverviewPage />} />
              <Route path="map-editor" element={<AdminMapBuilderPage />} />
              <Route path="dataset" element={<AdminDatasetPage />} />
              <Route path="people" element={<AdminPeoplePage />} />
              <Route path="closures" element={<AdminClosuresPage />} />
              <Route path="profile" element={<AdminProfilePage />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AppErrorBoundary>
  );
};

export default App;
