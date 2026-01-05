/**
 * Dashboard Page
 *
 * Project overview with stats, activity feed, and execution logs.
 */

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useTelegram } from '../hooks/useTelegram';
import styles from './DashboardPage.module.css';

interface DashboardStats {
  requirements: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    failed: number;
  };
  tasks: {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
  };
  execution: {
    isRunning: boolean;
    currentPhase: string | null;
  };
}

interface DashboardData {
  project: {
    id: string;
    name: string;
    path: string;
    status: string;
  };
  stats: DashboardStats;
  plan: {
    status: string;
    hasPendingQuestions: boolean;
  };
  lastUpdated: string;
}

interface DashboardResponse {
  success: boolean;
  dashboard: DashboardData;
}

interface ActivityItem {
  id: string;
  type: string;
  action: string;
  description: string;
  timestamp: string;
}

interface ActivityResponse {
  success: boolean;
  activity: ActivityItem[];
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  taskId?: string;
}

interface LogsResponse {
  success: boolean;
  logs: LogEntry[];
  hasMore: boolean;
}

export default function DashboardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [activeTab, setActiveTab] = useState<'activity' | 'logs'>('activity');
  const queryClient = useQueryClient();
  const { haptic, showConfirm } = useTelegram();

  const { data: dashboard, isLoading: dashboardLoading } = useQuery({
    queryKey: ['dashboard', projectId],
    queryFn: async () => {
      const response = await api.get<DashboardResponse>(`/projects/${projectId}/dashboard`);
      if (!response.success) {
        throw new Error(response.error?.message ?? 'Failed to load dashboard');
      }
      return response.data!.dashboard;
    },
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  const { data: activity, isLoading: activityLoading } = useQuery({
    queryKey: ['activity', projectId],
    queryFn: async () => {
      const response = await api.get<ActivityResponse>(
        `/projects/${projectId}/dashboard/activity?limit=10`
      );
      if (!response.success) {
        throw new Error(response.error?.message ?? 'Failed to load activity');
      }
      return response.data!.activity;
    },
    enabled: activeTab === 'activity',
  });

  const { data: logs, isLoading: logsLoading } = useQuery({
    queryKey: ['logs', projectId],
    queryFn: async () => {
      const response = await api.get<LogsResponse>(
        `/projects/${projectId}/dashboard/logs?lines=50`
      );
      if (!response.success) {
        throw new Error(response.error?.message ?? 'Failed to load logs');
      }
      return response.data!.logs;
    },
    enabled: activeTab === 'logs',
    refetchInterval: activeTab === 'logs' ? 5000 : false, // Auto-refresh logs
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(`/projects/${projectId}/dashboard/start`);
      if (!response.success) {
        throw new Error(response.error?.message ?? 'Failed to start execution');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', projectId] });
      haptic?.notificationOccurred('success');
    },
  });

  const stopMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(`/projects/${projectId}/dashboard/stop`);
      if (!response.success) {
        throw new Error(response.error?.message ?? 'Failed to stop execution');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', projectId] });
      haptic?.notificationOccurred('success');
    },
  });

  const handleStart = async () => {
    const confirmed = await showConfirm('Start execution for this project?');
    if (confirmed) {
      startMutation.mutate();
    }
  };

  const handleStop = async () => {
    const confirmed = await showConfirm('Stop execution?');
    if (confirmed) {
      stopMutation.mutate();
    }
  };

  if (dashboardLoading) {
    return <div className={styles.loading}>Loading dashboard...</div>;
  }

  if (!dashboard) {
    return <div className={styles.error}>Failed to load dashboard</div>;
  }

  const { stats, plan } = dashboard;

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>{dashboard.project.name}</h2>

      {/* Status Card */}
      <div className={styles.statusCard}>
        <div className={styles.statusHeader}>
          <span className={styles.statusLabel}>Status</span>
          <span className={`${styles.statusValue} ${styles[dashboard.project.status]}`}>
            {dashboard.project.status}
          </span>
        </div>
        {stats.execution.isRunning && (
          <div className={styles.runningIndicator}>
            <span className={styles.pulse}></span>
            Running: {stats.execution.currentPhase}
          </div>
        )}
        <div className={styles.executionControls}>
          {stats.execution.isRunning ? (
            <button
              className={styles.stopButton}
              onClick={handleStop}
              disabled={stopMutation.isPending}
            >
              {stopMutation.isPending ? 'Stopping...' : 'Stop Execution'}
            </button>
          ) : (
            <button
              className={styles.startButton}
              onClick={handleStart}
              disabled={startMutation.isPending}
            >
              {startMutation.isPending ? 'Starting...' : 'Start Execution'}
            </button>
          )}
        </div>
      </div>

      {/* Stats Grid */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{stats.requirements.total}</div>
          <div className={styles.statLabel}>Requirements</div>
          <div className={styles.statBreakdown}>
            {stats.requirements.pending > 0 && (
              <span className={styles.pending}>{stats.requirements.pending} pending</span>
            )}
            {stats.requirements.inProgress > 0 && (
              <span className={styles.inProgress}>{stats.requirements.inProgress} in progress</span>
            )}
            {stats.requirements.completed > 0 && (
              <span className={styles.completed}>{stats.requirements.completed} completed</span>
            )}
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statValue}>{stats.tasks.total}</div>
          <div className={styles.statLabel}>Tasks</div>
          <div className={styles.statBreakdown}>
            {stats.tasks.running > 0 && (
              <span className={styles.inProgress}>{stats.tasks.running} running</span>
            )}
            {stats.tasks.completed > 0 && (
              <span className={styles.completed}>{stats.tasks.completed} done</span>
            )}
          </div>
        </div>
      </div>

      {/* Plan Status */}
      {plan.status !== 'none' && (
        <div className={styles.planCard}>
          <div className={styles.planHeader}>
            <span>Plan</span>
            <span className={`${styles.planStatus} ${styles[plan.status]}`}>
              {plan.status.replace('_', ' ')}
            </span>
          </div>
          {plan.hasPendingQuestions && (
            <p className={styles.planAlert}>
              ⚠️ Questions need answers before approval
            </p>
          )}
        </div>
      )}

      {/* Activity/Logs Section */}
      <div className={styles.activitySection}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTabs}>
            <button
              className={`${styles.sectionTab} ${activeTab === 'activity' ? styles.active : ''}`}
              onClick={() => setActiveTab('activity')}
            >
              Activity
            </button>
            <button
              className={`${styles.sectionTab} ${activeTab === 'logs' ? styles.active : ''}`}
              onClick={() => setActiveTab('logs')}
            >
              Logs
            </button>
          </div>
        </div>

        {activeTab === 'activity' && (
          <>
            {activityLoading ? (
              <div className={styles.loading}>Loading activity...</div>
            ) : activity && activity.length > 0 ? (
              <div className={styles.activityList}>
                {activity.map((item) => (
                  <div key={item.id} className={styles.activityItem}>
                    <span className={styles.activityIcon}>
                      {item.type === 'requirement' ? '📋' : item.type === 'task' ? '⚙️' : '📝'}
                    </span>
                    <div className={styles.activityContent}>
                      <p className={styles.activityDescription}>{item.description}</p>
                      <span className={styles.activityTime}>
                        {new Date(item.timestamp).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.noActivity}>No recent activity</p>
            )}
          </>
        )}

        {activeTab === 'logs' && (
          <>
            {logsLoading ? (
              <div className={styles.loading}>Loading logs...</div>
            ) : logs && logs.length > 0 ? (
              <div className={styles.logsList}>
                {logs.map((log, index) => (
                  <div
                    key={`${log.timestamp}-${index}`}
                    className={`${styles.logItem} ${styles[log.level] ?? ''}`}
                  >
                    <span className={styles.logTime}>
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span className={`${styles.logLevel} ${styles[log.level] ?? ''}`}>
                      {log.level.toUpperCase()}
                    </span>
                    <span className={styles.logMessage}>{log.message}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.noActivity}>No logs available</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
