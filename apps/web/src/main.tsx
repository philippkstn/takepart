import '@fontsource-variable/figtree';
import './index.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider, useParams } from 'react-router';
import { FullScreenSpinner, ToastProvider } from './components/ui.tsx';
import { HomePage } from './pages/HomePage.tsx';

// Teilnehmer-Seiten bleiben klein; Admin, Editor und Beamer werden nachgeladen.
const ParticipantPage = lazy(() => import('./pages/ParticipantPage.tsx'));
const LoginPage = lazy(() => import('./pages/LoginPage.tsx'));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout.tsx'));
const PresentationsPage = lazy(() => import('./pages/admin/PresentationsPage.tsx'));
const EditorPage = lazy(() => import('./pages/admin/EditorPage.tsx'));
const ControlPage = lazy(() => import('./pages/admin/ControlPage.tsx'));
const ArchivePage = lazy(() => import('./pages/admin/ArchivePage.tsx'));
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage.tsx'));
const DisplayPage = lazy(() => import('./pages/DisplayPage.tsx'));
const HandoutPage = lazy(() => import('./pages/HandoutPage.tsx'));

function CodeRoute() {
  const { code = '' } = useParams();
  if (!/^\d{6}$/.test(code)) return <Navigate to="/" replace />;
  return <ParticipantPage code={code} />;
}

const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/d/:token', element: <DisplayPage /> },
  { path: '/h/:token', element: <HandoutPage /> },
  {
    path: '/admin',
    element: <AdminLayout />,
    children: [
      { index: true, element: <PresentationsPage /> },
      { path: 'p/:id', element: <EditorPage /> },
      { path: 'runs/:runId', element: <ArchivePage /> },
      { path: 'einstellungen', element: <SettingsPage /> },
    ],
  },
  { path: '/admin/live/:runId', element: <ControlPage /> },
  { path: '/:code', element: <CodeRoute /> },
  { path: '*', element: <Navigate to="/" replace /> },
]);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Suspense fallback={<FullScreenSpinner />}>
          <RouterProvider router={router} />
        </Suspense>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
