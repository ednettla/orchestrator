/**
 * Admin Page
 *
 * Administrative panel for managing users, allowed paths, and webapp config.
 * Only accessible to users with admin role.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useTelegram } from '../hooks/useTelegram';
import styles from './AdminPage.module.css';

// Types
interface AllowedPath {
  id: string;
  path: string;
  description: string | null;
  addedBy: number;
  createdAt: string;
}

interface User {
  id: string;
  telegramId: number;
  displayName: string;
  role: 'viewer' | 'operator' | 'admin';
  lastActiveAt: string | null;
  authorizedAt: string;
}

interface WebAppConfig {
  enabled: boolean;
  port: number;
  baseUrl: string | null;
}

interface SystemStatus {
  daemon: {
    running: boolean;
    uptime: number;
    memoryUsage: {
      heapUsed: number;
      heapTotal: number;
      rss: number;
    };
  };
  bot: {
    configured: boolean;
  };
  webapp: WebAppConfig;
  users: {
    total: number;
    admins: number;
    operators: number;
    viewers: number;
  };
  allowedPaths: {
    total: number;
  };
}

interface PathsResponse {
  success: boolean;
  paths: AllowedPath[];
}

interface UsersResponse {
  success: boolean;
  users: User[];
}

interface ConfigResponse {
  success: boolean;
  config: WebAppConfig;
}

interface StatusResponse {
  success: boolean;
  status: SystemStatus;
}

export default function AdminPage() {
  const queryClient = useQueryClient();
  const { showConfirm, haptic } = useTelegram();
  const [activeTab, setActiveTab] = useState<'status' | 'users' | 'paths' | 'config'>('status');
  const [newPath, setNewPath] = useState('');
  const [newPathDesc, setNewPathDesc] = useState('');
  const [showAddPath, setShowAddPath] = useState(false);

  // Fetch system status
  const { data: statusData, isLoading: statusLoading } = useQuery({
    queryKey: ['admin-status'],
    queryFn: async () => {
      const response = await api.get<StatusResponse>('/admin/status');
      if (!response.success) throw new Error(response.error?.message ?? 'Failed to load status');
      return response.data!.status;
    },
    refetchInterval: 30000,
  });

  // Fetch users
  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const response = await api.get<UsersResponse>('/admin/users');
      if (!response.success) throw new Error(response.error?.message ?? 'Failed to load users');
      return response.data!.users;
    },
    enabled: activeTab === 'users',
  });

  // Fetch allowed paths
  const { data: pathsData, isLoading: pathsLoading } = useQuery({
    queryKey: ['admin-paths'],
    queryFn: async () => {
      const response = await api.get<PathsResponse>('/admin/allowed-paths');
      if (!response.success) throw new Error(response.error?.message ?? 'Failed to load paths');
      return response.data!.paths;
    },
    enabled: activeTab === 'paths',
  });

  // Fetch config
  const { data: configData, isLoading: configLoading } = useQuery({
    queryKey: ['admin-config'],
    queryFn: async () => {
      const response = await api.get<ConfigResponse>('/admin/config/webapp');
      if (!response.success) throw new Error(response.error?.message ?? 'Failed to load config');
      return response.data!.config;
    },
    enabled: activeTab === 'config',
  });

  // Update user role mutation
  const updateRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const response = await api.put(`/admin/users/${userId}/role`, { role });
      if (!response.success) throw new Error(response.error?.message ?? 'Failed to update role');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-status'] });
      haptic?.notificationOccurred('success');
    },
  });

  // Delete user mutation
  const deleteUser = useMutation({
    mutationFn: async (userId: string) => {
      const response = await api.delete(`/admin/users/${userId}`);
      if (!response.success) throw new Error(response.error?.message ?? 'Failed to delete user');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-status'] });
      haptic?.notificationOccurred('success');
    },
  });

  // Add path mutation
  const addPath = useMutation({
    mutationFn: async ({ path, description }: { path: string; description?: string }) => {
      const response = await api.post('/admin/allowed-paths', { path, description });
      if (!response.success) throw new Error(response.error?.message ?? 'Failed to add path');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-paths'] });
      queryClient.invalidateQueries({ queryKey: ['admin-status'] });
      setNewPath('');
      setNewPathDesc('');
      setShowAddPath(false);
      haptic?.notificationOccurred('success');
    },
  });

  // Delete path mutation
  const deletePath = useMutation({
    mutationFn: async (pathId: string) => {
      const response = await api.delete(`/admin/allowed-paths/${pathId}`);
      if (!response.success) throw new Error(response.error?.message ?? 'Failed to delete path');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-paths'] });
      queryClient.invalidateQueries({ queryKey: ['admin-status'] });
      haptic?.notificationOccurred('success');
    },
  });

  // Update config mutation
  const updateConfig = useMutation({
    mutationFn: async (config: Partial<WebAppConfig>) => {
      const response = await api.put('/admin/config/webapp', config);
      if (!response.success) throw new Error(response.error?.message ?? 'Failed to update config');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-config'] });
      haptic?.notificationOccurred('success');
    },
  });

  const handleDeleteUser = async (user: User) => {
    const confirmed = await showConfirm(`Remove user "${user.displayName}"? They will need to be re-authorized to access the webapp.`);
    if (confirmed) {
      deleteUser.mutate(user.id);
    }
  };

  const handleDeletePath = async (path: AllowedPath) => {
    const confirmed = await showConfirm(`Remove allowed path "${path.path}"? Projects in this path will no longer be accessible.`);
    if (confirmed) {
      deletePath.mutate(path.id);
    }
  };

  const handleAddPath = () => {
    if (!newPath.trim()) return;
    addPath.mutate({ path: newPath.trim(), description: newPathDesc.trim() || undefined });
  };

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const formatMemory = (bytes: number) => {
    const mb = bytes / 1024 / 1024;
    return `${mb.toFixed(0)} MB`;
  };

  const getRoleBadgeClass = (role: string) => {
    switch (role) {
      case 'admin': return styles.roleAdmin;
      case 'operator': return styles.roleOperator;
      default: return styles.roleViewer;
    }
  };

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>Admin Panel</h2>

      {/* Tabs */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === 'status' ? styles.active : ''}`}
          onClick={() => setActiveTab('status')}
        >
          Status
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'users' ? styles.active : ''}`}
          onClick={() => setActiveTab('users')}
        >
          Users
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'paths' ? styles.active : ''}`}
          onClick={() => setActiveTab('paths')}
        >
          Paths
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'config' ? styles.active : ''}`}
          onClick={() => setActiveTab('config')}
        >
          Config
        </button>
      </div>

      {/* Status Tab */}
      {activeTab === 'status' && (
        <div className={styles.tabContent}>
          {statusLoading ? (
            <div className={styles.loading}>Loading status...</div>
          ) : statusData ? (
            <>
              {/* Daemon Status */}
              <div className={styles.statusCard}>
                <div className={styles.statusHeader}>
                  <span className={styles.statusIcon}>🔧</span>
                  <span className={styles.statusTitle}>Daemon</span>
                  <span className={`${styles.statusBadge} ${styles.statusOk}`}>Running</span>
                </div>
                <div className={styles.statusDetails}>
                  <div className={styles.statusItem}>
                    <span className={styles.statusLabel}>Uptime</span>
                    <span className={styles.statusValue}>{formatUptime(statusData.daemon.uptime)}</span>
                  </div>
                  <div className={styles.statusItem}>
                    <span className={styles.statusLabel}>Memory</span>
                    <span className={styles.statusValue}>{formatMemory(statusData.daemon.memoryUsage.heapUsed)}</span>
                  </div>
                </div>
              </div>

              {/* Stats Grid */}
              <div className={styles.statsGrid}>
                <div className={styles.statCard}>
                  <div className={styles.statValue}>{statusData.users.total}</div>
                  <div className={styles.statLabel}>Users</div>
                  <div className={styles.statBreakdown}>
                    <span>{statusData.users.admins} admin</span>
                    <span>{statusData.users.operators} operator</span>
                    <span>{statusData.users.viewers} viewer</span>
                  </div>
                </div>
                <div className={styles.statCard}>
                  <div className={styles.statValue}>{statusData.allowedPaths.total}</div>
                  <div className={styles.statLabel}>Allowed Paths</div>
                </div>
              </div>

              {/* Bot Status */}
              <div className={styles.statusCard}>
                <div className={styles.statusHeader}>
                  <span className={styles.statusIcon}>🤖</span>
                  <span className={styles.statusTitle}>Telegram Bot</span>
                  <span className={`${styles.statusBadge} ${statusData.bot.configured ? styles.statusOk : styles.statusWarning}`}>
                    {statusData.bot.configured ? 'Connected' : 'Not Configured'}
                  </span>
                </div>
              </div>

              {/* WebApp Status */}
              <div className={styles.statusCard}>
                <div className={styles.statusHeader}>
                  <span className={styles.statusIcon}>🌐</span>
                  <span className={styles.statusTitle}>WebApp</span>
                  <span className={`${styles.statusBadge} ${statusData.webapp.enabled ? styles.statusOk : styles.statusWarning}`}>
                    {statusData.webapp.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <div className={styles.statusDetails}>
                  <div className={styles.statusItem}>
                    <span className={styles.statusLabel}>Port</span>
                    <span className={styles.statusValue}>{statusData.webapp.port}</span>
                  </div>
                  {statusData.webapp.baseUrl && (
                    <div className={styles.statusItem}>
                      <span className={styles.statusLabel}>URL</span>
                      <span className={styles.statusValue}>{statusData.webapp.baseUrl}</span>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className={styles.error}>Failed to load status</div>
          )}
        </div>
      )}

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className={styles.tabContent}>
          {usersLoading ? (
            <div className={styles.loading}>Loading users...</div>
          ) : usersData?.length ? (
            <div className={styles.userList}>
              {usersData.map((user) => (
                <div key={user.id} className={styles.userCard}>
                  <div className={styles.userHeader}>
                    <div className={styles.userInfo}>
                      <span className={styles.userName}>{user.displayName}</span>
                      <span className={styles.userId}>ID: {user.telegramId}</span>
                    </div>
                    <span className={`${styles.roleBadge} ${getRoleBadgeClass(user.role)}`}>
                      {user.role}
                    </span>
                  </div>
                  <div className={styles.userDetails}>
                    <span className={styles.userMeta}>
                      Joined: {new Date(user.authorizedAt).toLocaleDateString()}
                    </span>
                    {user.lastActiveAt && (
                      <span className={styles.userMeta}>
                        Last active: {new Date(user.lastActiveAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <div className={styles.userActions}>
                    <select
                      className={styles.roleSelect}
                      value={user.role}
                      onChange={(e) => updateRole.mutate({ userId: user.id, role: e.target.value })}
                      disabled={updateRole.isPending}
                    >
                      <option value="viewer">Viewer</option>
                      <option value="operator">Operator</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button
                      className={styles.deleteButton}
                      onClick={() => handleDeleteUser(user)}
                      disabled={deleteUser.isPending}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              <span className={styles.emptyIcon}>👥</span>
              <p>No users found</p>
            </div>
          )}
        </div>
      )}

      {/* Paths Tab */}
      {activeTab === 'paths' && (
        <div className={styles.tabContent}>
          {/* Add Path Button */}
          {!showAddPath && (
            <button className={styles.addButton} onClick={() => setShowAddPath(true)}>
              + Add Allowed Path
            </button>
          )}

          {/* Add Path Form */}
          {showAddPath && (
            <div className={styles.addForm}>
              <input
                type="text"
                className={styles.input}
                placeholder="/path/to/projects"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
              />
              <input
                type="text"
                className={styles.input}
                placeholder="Description (optional)"
                value={newPathDesc}
                onChange={(e) => setNewPathDesc(e.target.value)}
              />
              <div className={styles.formActions}>
                <button
                  className={styles.submitButton}
                  onClick={handleAddPath}
                  disabled={!newPath.trim() || addPath.isPending}
                >
                  Add Path
                </button>
                <button
                  className={styles.cancelButton}
                  onClick={() => {
                    setShowAddPath(false);
                    setNewPath('');
                    setNewPathDesc('');
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {pathsLoading ? (
            <div className={styles.loading}>Loading paths...</div>
          ) : pathsData?.length ? (
            <div className={styles.pathList}>
              {pathsData.map((path) => (
                <div key={path.id} className={styles.pathCard}>
                  <div className={styles.pathHeader}>
                    <span className={styles.pathIcon}>📁</span>
                    <div className={styles.pathInfo}>
                      <span className={styles.pathValue}>{path.path}</span>
                      {path.description && (
                        <span className={styles.pathDesc}>{path.description}</span>
                      )}
                    </div>
                  </div>
                  <div className={styles.pathDetails}>
                    <span className={styles.pathMeta}>
                      Added: {new Date(path.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className={styles.pathActions}>
                    <button
                      className={styles.deleteButton}
                      onClick={() => handleDeletePath(path)}
                      disabled={deletePath.isPending}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              <span className={styles.emptyIcon}>📁</span>
              <p>No allowed paths configured</p>
              <p className={styles.emptyHint}>
                Add paths where projects can be created and managed.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Config Tab */}
      {activeTab === 'config' && (
        <div className={styles.tabContent}>
          {configLoading ? (
            <div className={styles.loading}>Loading config...</div>
          ) : configData ? (
            <div className={styles.configList}>
              <div className={styles.configCard}>
                <div className={styles.configHeader}>
                  <span className={styles.configLabel}>WebApp Enabled</span>
                  <label className={styles.toggle}>
                    <input
                      type="checkbox"
                      checked={configData.enabled}
                      onChange={(e) => updateConfig.mutate({ enabled: e.target.checked })}
                      disabled={updateConfig.isPending}
                    />
                    <span className={styles.toggleSlider}></span>
                  </label>
                </div>
                <p className={styles.configHint}>
                  Enable or disable the webapp server
                </p>
              </div>

              <div className={styles.configCard}>
                <div className={styles.configHeader}>
                  <span className={styles.configLabel}>Port</span>
                  <input
                    type="number"
                    className={styles.configInput}
                    value={configData.port}
                    onChange={(e) => {
                      const port = parseInt(e.target.value, 10);
                      if (port > 0 && port <= 65535) {
                        updateConfig.mutate({ port });
                      }
                    }}
                    disabled={updateConfig.isPending}
                    min="1"
                    max="65535"
                  />
                </div>
                <p className={styles.configHint}>
                  Port for the webapp server (1-65535)
                </p>
              </div>

              <div className={styles.configCard}>
                <div className={styles.configHeader}>
                  <span className={styles.configLabel}>Base URL</span>
                </div>
                <input
                  type="text"
                  className={styles.input}
                  value={configData.baseUrl ?? ''}
                  onChange={(e) => updateConfig.mutate({ baseUrl: e.target.value || undefined })}
                  disabled={updateConfig.isPending}
                  placeholder="https://your-domain.com"
                />
                <p className={styles.configHint}>
                  Public URL for the webapp (optional, used for Telegram Mini App)
                </p>
              </div>

              <div className={styles.configNote}>
                Changes may require a daemon restart to take effect.
              </div>
            </div>
          ) : (
            <div className={styles.error}>Failed to load config</div>
          )}
        </div>
      )}
    </div>
  );
}
