/**
 * Project Page
 *
 * Container for project detail tabs.
 */

import { Outlet, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

interface Project {
  id: string;
  name: string;
  path: string;
  status: string;
}

interface ProjectResponse {
  success: boolean;
  project: Project;
}

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: project, isLoading, error } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const response = await api.get<ProjectResponse>(`/projects/${projectId}`);
      if (!response.success) {
        throw new Error(response.error?.message ?? 'Failed to load project');
      }
      return response.data!.project;
    },
    enabled: !!projectId,
  });

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--hint-color)' }}>
        Loading project...
      </div>
    );
  }

  if (error || !project) {
    const handleRetry = () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    };

    return (
      <div style={{ textAlign: 'center', padding: '2rem' }}>
        <div style={{ color: 'var(--status-failed)', marginBottom: '1rem' }}>
          Failed to load project
        </div>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
          <button
            onClick={handleRetry}
            style={{
              padding: '0.5rem 1rem',
              background: 'var(--button-color)',
              color: 'var(--button-text-color)',
              border: 'none',
              borderRadius: 'var(--border-radius-sm)',
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
          <button
            onClick={() => navigate('/projects')}
            style={{
              padding: '0.5rem 1rem',
              background: 'rgba(255, 255, 255, 0.1)',
              color: 'var(--text-color)',
              border: 'none',
              borderRadius: 'var(--border-radius-sm)',
              cursor: 'pointer',
            }}
          >
            Back to Projects
          </button>
        </div>
      </div>
    );
  }

  return <Outlet context={{ project }} />;
}
