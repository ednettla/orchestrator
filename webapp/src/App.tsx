/**
 * App Root Component
 *
 * Sets up routing and authentication.
 */

import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useTelegram } from './hooks/useTelegram';
import { api } from './api/client';

// Pages
import ProjectsPage from './pages/ProjectsPage';
import ProjectPage from './pages/ProjectPage';
import RequirementsPage from './pages/RequirementsPage';
import PlanPage from './pages/PlanPage';
import DashboardPage from './pages/DashboardPage';
import AuthPage from './pages/AuthPage';

// Components
import Layout from './components/Layout';
import LoadingScreen from './components/LoadingScreen';
import ErrorScreen from './components/ErrorScreen';

interface AuthState {
  status: 'loading' | 'authenticated' | 'error';
  user: {
    id: number;
    role: string;
    displayName: string;
  } | null;
  error: string | null;
}

function App() {
  const { initData, isReady } = useTelegram();
  const [auth, setAuth] = useState<AuthState>({
    status: 'loading',
    user: null,
    error: null,
  });

  useEffect(() => {
    if (!isReady) return;

    async function authenticate() {
      // In development, create mock auth if no initData
      if (!initData && import.meta.env.DEV) {
        setAuth({
          status: 'authenticated',
          user: {
            id: 0,
            role: 'admin',
            displayName: 'Dev User',
          },
          error: null,
        });
        return;
      }

      if (!initData) {
        setAuth({
          status: 'error',
          user: null,
          error: 'Not opened from Telegram',
        });
        return;
      }

      try {
        const result = await api.authenticate(initData);
        setAuth({
          status: 'authenticated',
          user: result.user,
          error: null,
        });
      } catch (error) {
        setAuth({
          status: 'error',
          user: null,
          error: error instanceof Error ? error.message : 'Authentication failed',
        });
      }
    }

    authenticate();
  }, [isReady, initData]);

  // Show loading while Telegram WebApp initializes
  if (!isReady) {
    return <LoadingScreen message="Initializing..." />;
  }

  // Show loading while authenticating
  if (auth.status === 'loading') {
    return <LoadingScreen message="Authenticating..." />;
  }

  // Show error if authentication failed
  if (auth.status === 'error') {
    return (
      <ErrorScreen
        title="Authentication Failed"
        message={auth.error ?? 'Unable to authenticate'}
        action={{
          label: 'Retry',
          onClick: () => window.location.reload(),
        }}
      />
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout user={auth.user!} />}>
          <Route index element={<Navigate to="/projects" replace />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="auth" element={<AuthPage />} />
          <Route path="project/:projectId" element={<ProjectPage />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="requirements" element={<RequirementsPage />} />
            <Route path="plan" element={<PlanPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
