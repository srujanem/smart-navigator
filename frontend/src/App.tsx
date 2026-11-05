import React, { useEffect } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { VenuesPage } from './pages/VenuesPage';
import { VenuePage } from './pages/VenuePage';
import { RoutePage } from './pages/RoutePage';
import { PeoplePage } from './pages/PeoplePage';
import { AdminLoginPage } from './pages/admin/AdminLoginPage';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AdminOverviewPage } from './pages/admin/AdminOverviewPage';
import { AdminDatasetPage } from './pages/admin/AdminDatasetPage';
import { AdminPeoplePage } from './pages/admin/AdminPeoplePage';
import { AdminClosuresPage } from './pages/admin/AdminClosuresPage';
import { AdminMapBuilderPage } from './pages/admin/AdminMapBuilderPage';
import { AdminProfilePage } from './pages/admin/AdminProfilePage';

const ScrollToTop: React.FC = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
};

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <ScrollToTop />
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
    </BrowserRouter>
  );
};

export default App;
