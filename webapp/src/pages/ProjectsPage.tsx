/**
 * Projects Page
 *
 * List of all projects.
 */

import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import styles from './ProjectsPage.module.css';

interface Project {
  id: string;
  name: string;
  path: string;
  status: string;
  alias?: string;
}

interface ProjectsResponse {
  success: boolean;
  projects: Project[];
}

export default function ProjectsPage() {
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const response = await api.get<ProjectsResponse>('/projects');
      if (!response.success) {
        throw new Error(response.error?.message ?? 'Failed to load projects');
      }
      return response.data!.projects;
    },
  });

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>Loading projects...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.error}>
        <p>Failed to load projects</p>
        <p className={styles.errorDetail}>{(error as Error).message}</p>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>📁</div>
        <h2>No Projects</h2>
        <p>Initialize a project from the Telegram bot to get started.</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>Projects</h2>
      <div className={styles.list}>
        {data.map((project) => (
          <button
            key={project.id}
            className={styles.projectCard}
            onClick={() => navigate(`/project/${project.id}`)}
          >
            <div className={styles.projectInfo}>
              <h3 className={styles.projectName}>{project.name}</h3>
              <p className={styles.projectPath}>{project.path}</p>
            </div>
            <span className={`${styles.status} ${styles[project.status] ?? ''}`}>
              {project.status}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
