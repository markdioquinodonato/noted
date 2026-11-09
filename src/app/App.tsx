import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, Link, Outlet, RouterProvider } from 'react-router';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/BrandLogo';
import { AuthProvider } from '@/features/auth/AuthProvider';
import {
  AuthCallbackPage,
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  RequireAuth,
  ResetPasswordPage,
  RootRedirect,
  WelcomePage,
} from '@/features/auth/pages';
import { Workspace } from '@/features/notes/Workspace';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { ImportPage } from '@/features/migration/ImportPage';
import { RepositoryProvider } from './RepositoryProvider';

import { createQueryClient } from './queryClient';
import { useUpdateCheck } from './useUpdateCheck';
import { DownloadDialogHost } from '@/features/download/DownloadDialog';
export { createQueryClient } from './queryClient';

function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <BrandLogo size={80} />
      <h1 className="text-xl font-semibold">Page not found</h1>
      <Button asChild>
        <Link to="/notes">Go to my notes</Link>
      </Button>
    </div>
  );
}

function RouteError() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        An unexpected error occurred. Your notes are safe — unsaved edits are kept on this device.
        Reload to continue.
      </p>
      <Button onClick={() => window.location.reload()}>Reload</Button>
    </div>
  );
}

function Shell() {
  useUpdateCheck();
  return (
    <AuthProvider>
      <RepositoryProvider>
        <TooltipProvider delayDuration={400}>
          <Outlet />
          <DownloadDialogHost />
          <Toaster position="bottom-center" closeButton />
        </TooltipProvider>
      </RepositoryProvider>
    </AuthProvider>
  );
}

export const routes = [
  {
    element: <Shell />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <RootRedirect /> },
      { path: '/welcome', element: <WelcomePage /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
      { path: '/auth/callback', element: <AuthCallbackPage /> },
      { path: '/notes', element: <Workspace /> },
      { path: '/notes/:noteId', element: <Workspace /> },
      { path: '/settings', element: <SettingsPage /> },
      {
        path: '/import',
        element: (
          <RequireAuth>
            <ImportPage />
          </RequireAuth>
        ),
      },
      { path: '*', element: <NotFound /> },
    ],
  },
];

const router = createBrowserRouter(routes);
const queryClient = createQueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
