/**
 * Layout Component
 *
 * Main app layout with header and navigation.
 */

import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import styles from './Layout.module.css';

interface LayoutProps {
  user: {
    id: number;
    role: string;
    displayName: string;
  };
}

export default function Layout({ user }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();

  // Extract project ID from path if on a project page
  const projectMatch = location.pathname.match(/\/project\/([^/]+)/);
  const projectId = projectMatch?.[1];

  const isAdmin = user.role === 'admin';

  const navItems = projectId
    ? [
        { path: `/project/${projectId}/dashboard`, label: 'Dashboard', icon: '📊' },
        { path: `/project/${projectId}/requirements`, label: 'Requirements', icon: '📋' },
        { path: `/project/${projectId}/plan`, label: 'Plan', icon: '📝' },
      ]
    : [
        { path: '/projects', label: 'Projects', icon: '📁' },
        { path: '/auth', label: 'Auth', icon: '🔐' },
        ...(isAdmin ? [{ path: '/admin', label: 'Admin', icon: '⚙️' }] : []),
      ];

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <h1 className={styles.title}>
            {projectId ? (
              <button className={styles.backButton} onClick={() => navigate('/projects')}>
                ← Projects
              </button>
            ) : (
              'Orchestrator'
            )}
          </h1>
          <span className={styles.userBadge}>{user.displayName}</span>
        </div>
      </header>

      <main className={styles.main}>
        <Outlet />
      </main>

      <nav className={styles.nav}>
        {navItems.map((item) => (
          <button
            key={item.path}
            className={`${styles.navItem} ${location.pathname === item.path || location.pathname.startsWith(item.path + '/') ? styles.active : ''}`}
            onClick={() => navigate(item.path)}
          >
            <span className={styles.navIcon}>{item.icon}</span>
            <span className={styles.navLabel}>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
