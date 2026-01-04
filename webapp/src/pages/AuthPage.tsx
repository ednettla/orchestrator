/**
 * Auth Page
 *
 * Displays auth status, sources, errors, and paused pipelines.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import styles from './AuthPage.module.css';

// Types
interface AuthSource {
  id: string;
  name: string;
  service: string;
  displayName: string;
  authType: string;
  isDefault: boolean;
  lastVerifiedAt: string | null;
  expiresAt: string | null;
}

interface AuthError {
  id: string;
  projectPath: string;
  service: string;
  errorType: string;
  errorMessage: string;
  occurredAt: string;
  resolvedAt: string | null;
}

interface PausedPipeline {
  id: string;
  projectPath: string;
  jobId: string;
  requirementId: string;
  pausedPhase: string;
  service: string;
  pausedAt: string;
  status: string;
}

interface AuthStatus {
  service: string;
  sourceName: string | null;
  displayName?: string;
  status: 'ok' | 'expired' | 'invalid' | 'not_configured';
  lastChecked: string | null;
  expiresAt: string | null;
}

interface AuthStatusResponse {
  success: boolean;
  authStatus: AuthStatus[];
  summary: {
    totalSources: number;
    pausedPipelines: number;
    serviceStatus: Record<string, string>;
  };
}

interface SourcesResponse {
  success: boolean;
  sources: AuthSource[];
}

interface PipelinesResponse {
  success: boolean;
  pipelines: PausedPipeline[];
}

export default function AuthPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'status' | 'sources' | 'pipelines'>('status');

  // Fetch auth status
  const { data: statusData, isLoading: statusLoading } = useQuery({
    queryKey: ['auth-status'],
    queryFn: async () => {
      const response = await api.get<AuthStatusResponse>('/auth/status');
      if (!response.success) throw new Error(response.error?.message ?? 'Failed to load auth status');
      return response.data!;
    },
    refetchInterval: 30000,
  });

  // Fetch auth sources (admin only)
  const { data: sourcesData, isLoading: sourcesLoading } = useQuery({
    queryKey: ['auth-sources'],
    queryFn: async () => {
      const response = await api.get<SourcesResponse>('/auth/sources');
      if (!response.success) throw new Error(response.error?.message ?? 'Failed to load auth sources');
      return response.data!;
    },
    enabled: activeTab === 'sources',
  });

  // Fetch paused pipelines
  const { data: pipelinesData, isLoading: pipelinesLoading } = useQuery({
    queryKey: ['paused-pipelines'],
    queryFn: async () => {
      const response = await api.get<PipelinesResponse>('/auth/pipelines/paused?status=paused');
      if (!response.success) throw new Error(response.error?.message ?? 'Failed to load pipelines');
      return response.data!;
    },
    enabled: activeTab === 'pipelines',
  });

  // Resume pipeline mutation
  const resumePipeline = useMutation({
    mutationFn: async (pipelineId: string) => {
      const response = await api.post(`/auth/pipelines/paused/${pipelineId}/resume`);
      if (!response.success) throw new Error(response.error?.message ?? 'Failed to resume pipeline');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paused-pipelines'] });
      queryClient.invalidateQueries({ queryKey: ['auth-status'] });
    },
  });

  // Cancel pipeline mutation
  const cancelPipeline = useMutation({
    mutationFn: async (pipelineId: string) => {
      const response = await api.post(`/auth/pipelines/paused/${pipelineId}/cancel`);
      if (!response.success) throw new Error(response.error?.message ?? 'Failed to cancel pipeline');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paused-pipelines'] });
      queryClient.invalidateQueries({ queryKey: ['auth-status'] });
    },
  });

  // Set default auth source mutation
  const setDefault = useMutation({
    mutationFn: async (sourceName: string) => {
      const response = await api.post(`/auth/sources/${sourceName}/set-default`);
      if (!response.success) throw new Error(response.error?.message ?? 'Failed to set default');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth-sources'] });
      queryClient.invalidateQueries({ queryKey: ['auth-status'] });
    },
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ok': return styles.statusOk;
      case 'expired': return styles.statusExpired;
      case 'invalid': return styles.statusInvalid;
      default: return styles.statusNotConfigured;
    }
  };

  const getServiceIcon = (service: string) => {
    switch (service) {
      case 'github': return '🐙';
      case 'supabase': return '⚡';
      case 'vercel': return '▲';
      default: return '🔐';
    }
  };

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>Authentication</h2>

      {/* Tabs */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === 'status' ? styles.active : ''}`}
          onClick={() => setActiveTab('status')}
        >
          Status
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'sources' ? styles.active : ''}`}
          onClick={() => setActiveTab('sources')}
        >
          Sources
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'pipelines' ? styles.active : ''}`}
          onClick={() => setActiveTab('pipelines')}
        >
          Pipelines
          {statusData?.summary.pausedPipelines ? (
            <span className={styles.badge}>{statusData.summary.pausedPipelines}</span>
          ) : null}
        </button>
      </div>

      {/* Status Tab */}
      {activeTab === 'status' && (
        <div className={styles.tabContent}>
          {statusLoading ? (
            <div className={styles.loading}>Loading status...</div>
          ) : statusData ? (
            <>
              {/* Summary Cards */}
              <div className={styles.summaryGrid}>
                <div className={styles.summaryCard}>
                  <div className={styles.summaryValue}>{statusData.summary.totalSources}</div>
                  <div className={styles.summaryLabel}>Auth Sources</div>
                </div>
                <div className={styles.summaryCard}>
                  <div className={`${styles.summaryValue} ${statusData.summary.pausedPipelines > 0 ? styles.warning : ''}`}>
                    {statusData.summary.pausedPipelines}
                  </div>
                  <div className={styles.summaryLabel}>Paused Pipelines</div>
                </div>
              </div>

              {/* Service Status */}
              <div className={styles.serviceList}>
                {statusData.authStatus.map((service) => (
                  <div key={service.service} className={styles.serviceCard}>
                    <div className={styles.serviceHeader}>
                      <span className={styles.serviceIcon}>{getServiceIcon(service.service)}</span>
                      <span className={styles.serviceName}>{service.service}</span>
                      <span className={`${styles.serviceStatus} ${getStatusColor(service.status)}`}>
                        {service.status.replace('_', ' ')}
                      </span>
                    </div>
                    {service.sourceName && (
                      <div className={styles.serviceDetails}>
                        <span className={styles.sourceName}>{service.displayName ?? service.sourceName}</span>
                        {service.expiresAt && (
                          <span className={styles.expiresAt}>
                            Expires: {new Date(service.expiresAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className={styles.error}>Failed to load status</div>
          )}
        </div>
      )}

      {/* Sources Tab */}
      {activeTab === 'sources' && (
        <div className={styles.tabContent}>
          {sourcesLoading ? (
            <div className={styles.loading}>Loading sources...</div>
          ) : sourcesData?.sources.length ? (
            <div className={styles.sourceList}>
              {sourcesData.sources.map((source) => (
                <div key={source.id} className={styles.sourceCard}>
                  <div className={styles.sourceHeader}>
                    <span className={styles.serviceIcon}>{getServiceIcon(source.service)}</span>
                    <div className={styles.sourceInfo}>
                      <span className={styles.sourceName}>{source.displayName}</span>
                      <span className={styles.sourceType}>{source.authType}</span>
                    </div>
                    {source.isDefault && (
                      <span className={styles.defaultBadge}>Default</span>
                    )}
                  </div>
                  <div className={styles.sourceDetails}>
                    <span className={styles.sourceId}>{source.name}</span>
                    {source.lastVerifiedAt && (
                      <span className={styles.lastVerified}>
                        Last verified: {new Date(source.lastVerifiedAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                  {!source.isDefault && (
                    <button
                      className={styles.setDefaultButton}
                      onClick={() => setDefault.mutate(source.name)}
                      disabled={setDefault.isPending}
                    >
                      Set as Default
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              <span className={styles.emptyIcon}>🔐</span>
              <p>No auth sources configured</p>
              <p className={styles.emptyHint}>Use the CLI to add auth sources</p>
            </div>
          )}
        </div>
      )}

      {/* Pipelines Tab */}
      {activeTab === 'pipelines' && (
        <div className={styles.tabContent}>
          {pipelinesLoading ? (
            <div className={styles.loading}>Loading pipelines...</div>
          ) : pipelinesData?.pipelines.length ? (
            <div className={styles.pipelineList}>
              {pipelinesData.pipelines.map((pipeline) => (
                <div key={pipeline.id} className={styles.pipelineCard}>
                  <div className={styles.pipelineHeader}>
                    <span className={styles.serviceIcon}>{getServiceIcon(pipeline.service)}</span>
                    <div className={styles.pipelineInfo}>
                      <span className={styles.pipelinePath}>
                        {pipeline.projectPath.split('/').pop()}
                      </span>
                      <span className={styles.pipelinePhase}>
                        Paused at: {pipeline.pausedPhase}
                      </span>
                    </div>
                  </div>
                  <div className={styles.pipelineDetails}>
                    <span className={styles.pausedAt}>
                      {new Date(pipeline.pausedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className={styles.pipelineActions}>
                    <button
                      className={styles.resumeButton}
                      onClick={() => resumePipeline.mutate(pipeline.id)}
                      disabled={resumePipeline.isPending}
                    >
                      Resume
                    </button>
                    <button
                      className={styles.cancelButton}
                      onClick={() => cancelPipeline.mutate(pipeline.id)}
                      disabled={cancelPipeline.isPending}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              <span className={styles.emptyIcon}>✅</span>
              <p>No paused pipelines</p>
              <p className={styles.emptyHint}>All pipelines are running smoothly</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
