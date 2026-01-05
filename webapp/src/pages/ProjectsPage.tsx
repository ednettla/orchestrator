/**
 * Projects Page
 *
 * List of all projects with creation capability.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useTelegram } from '../hooks/useTelegram';
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
  const queryClient = useQueryClient();
  const { haptic } = useTelegram();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [projectName, setProjectName] = useState('');

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

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await api.post('/projects/create', { name });
      if (!response.success) {
        throw new Error(response.error?.message ?? 'Failed to create project');
      }
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setShowCreateModal(false);
      setProjectName('');
      haptic?.notificationOccurred('success');
    },
  });

  const handleCreate = () => {
    if (projectName.trim()) {
      createMutation.mutate(projectName.trim());
    }
  };

  const openCreateModal = () => {
    setShowCreateModal(true);
    haptic?.selectionChanged();
  };

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
        <p>Create your first project to get started.</p>
        <button className={styles.createButton} onClick={openCreateModal}>
          Create Project
        </button>

        {showCreateModal && (
          <div className={styles.modalOverlay} onClick={() => setShowCreateModal(false)}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
              <h3 className={styles.modalTitle}>Create Project</h3>
              <p className={styles.modalDescription}>
                Enter a name for your new project. It will be created in your projects directory.
              </p>
              <div className={styles.formGroup}>
                <input
                  type="text"
                  className={styles.formInput}
                  placeholder="my-project"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className={styles.modalActions}>
                <button
                  className={styles.modalCancel}
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button
                  className={styles.modalSubmit}
                  onClick={handleCreate}
                  disabled={!projectName.trim() || createMutation.isPending}
                >
                  {createMutation.isPending ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}
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

      {/* Floating Action Button */}
      <button className={styles.fab} onClick={openCreateModal}>
        +
      </button>

      {/* Create Project Modal */}
      {showCreateModal && (
        <div className={styles.modalOverlay} onClick={() => setShowCreateModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>Create Project</h3>
            <p className={styles.modalDescription}>
              Enter a name for your new project. It will be created in your projects directory.
            </p>
            <div className={styles.formGroup}>
              <input
                type="text"
                className={styles.formInput}
                placeholder="my-project"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                autoFocus
              />
            </div>
            <div className={styles.modalActions}>
              <button
                className={styles.modalCancel}
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </button>
              <button
                className={styles.modalSubmit}
                onClick={handleCreate}
                disabled={!projectName.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
