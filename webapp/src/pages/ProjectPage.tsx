/**
 * Project Page
 *
 * Container for project detail tabs.
 */

import { Outlet, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
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
    return (
      <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--status-failed)' }}>
        Failed to load project
      </div>
    );
  }

  return <Outlet context={{ project }} />;
}
