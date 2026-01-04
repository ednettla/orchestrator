/**
 * Requirements Page
 *
 * Full CRUD for project requirements.
 */

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useTelegram } from '../hooks/useTelegram';
import styles from './RequirementsPage.module.css';

interface Requirement {
  id: string;
  rawInput: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  priority: number;
  createdAt: string;
}

interface RequirementsResponse {
  success: boolean;
  requirements: Requirement[];
}

const STATUS_ICONS: Record<string, string> = {
  pending: '⏳',
  in_progress: '🔄',
  completed: '✅',
  failed: '❌',
};

export default function RequirementsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const { haptic, mainButton } = useTelegram();

  const [filter, setFilter] = useState<string>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const { data: requirements, isLoading, error } = useQuery({
    queryKey: ['requirements', projectId],
    queryFn: async () => {
      const response = await api.get<RequirementsResponse>(
        `/projects/${projectId}/requirements`
      );
      if (!response.success) {
        throw new Error(response.error?.message ?? 'Failed to load requirements');
      }
      return response.data!.requirements;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, text }: { id: string; text: string }) => {
      const response = await api.put(`/projects/${projectId}/requirements/${id}`, {
        rawInput: text,
      });
      if (!response.success) {
        throw new Error(response.error?.message ?? 'Failed to update');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['requirements', projectId] });
      setEditingId(null);
      haptic?.notificationOccurred('success');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await api.delete(`/projects/${projectId}/requirements/${id}`);
      if (!response.success) {
        throw new Error(response.error?.message ?? 'Failed to delete');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['requirements', projectId] });
      haptic?.notificationOccurred('success');
    },
  });

  const handleEdit = (req: Requirement) => {
    setEditingId(req.id);
    setEditText(req.rawInput);
    haptic?.selectionChanged();
  };

  const handleSave = () => {
    if (editingId && editText.trim()) {
      updateMutation.mutate({ id: editingId, text: editText.trim() });
    }
  };

  const handleDelete = async (id: string) => {
    haptic?.impactOccurred('medium');
    deleteMutation.mutate(id);
  };

  if (isLoading) {
    return <div className={styles.loading}>Loading requirements...</div>;
  }

  if (error) {
    return <div className={styles.error}>Failed to load requirements</div>;
  }

  const filteredReqs = requirements?.filter((r) => {
    if (filter === 'all') return true;
    return r.status === filter;
  }) ?? [];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>Requirements</h2>
        <div className={styles.filterButtons}>
          {['all', 'pending', 'in_progress', 'completed'].map((f) => (
            <button
              key={f}
              className={`${styles.filterButton} ${filter === f ? styles.active : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {filteredReqs.length === 0 ? (
        <div className={styles.empty}>
          <p>No {filter === 'all' ? '' : filter.replace('_', ' ')} requirements</p>
        </div>
      ) : (
        <div className={styles.list}>
          {filteredReqs.map((req) => (
            <div key={req.id} className={styles.card}>
              {editingId === req.id ? (
                <div className={styles.editForm}>
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className={styles.editInput}
                    rows={3}
                  />
                  <div className={styles.editActions}>
                    <button
                      className={styles.saveButton}
                      onClick={handleSave}
                      disabled={updateMutation.isPending}
                    >
                      Save
                    </button>
                    <button
                      className={styles.cancelButton}
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className={styles.cardHeader}>
                    <span className={styles.status}>
                      {STATUS_ICONS[req.status]} {req.status.replace('_', ' ')}
                    </span>
                    <span className={styles.priority}>P{req.priority}</span>
                  </div>
                  <p className={styles.text}>{req.rawInput}</p>
                  <div className={styles.cardActions}>
                    <button
                      className={styles.actionButton}
                      onClick={() => handleEdit(req)}
                    >
                      Edit
                    </button>
                    <button
                      className={`${styles.actionButton} ${styles.danger}`}
                      onClick={() => handleDelete(req.id)}
                      disabled={deleteMutation.isPending}
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
