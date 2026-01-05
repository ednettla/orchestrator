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
  const { haptic } = useTelegram();

  const [filter, setFilter] = useState<string>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newReqText, setNewReqText] = useState('');
  const [newReqPriority, setNewReqPriority] = useState(5);

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

  const createMutation = useMutation({
    mutationFn: async ({ text, priority }: { text: string; priority: number }) => {
      const response = await api.post(`/projects/${projectId}/requirements`, {
        title: text,  // API expects 'title'
        priority,
      });
      if (!response.success) {
        throw new Error(response.error?.message ?? 'Failed to create');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['requirements', projectId] });
      setShowAddModal(false);
      setNewReqText('');
      setNewReqPriority(5);
      haptic?.notificationOccurred('success');
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

  const runMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post(`/projects/${projectId}/requirements/${id}/run`);
      if (!response.success) {
        throw new Error(response.error?.message ?? 'Failed to run');
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

  const handleRun = (id: string) => {
    haptic?.impactOccurred('light');
    runMutation.mutate(id);
  };

  const handleCreate = () => {
    if (newReqText.trim()) {
      createMutation.mutate({ text: newReqText.trim(), priority: newReqPriority });
    }
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
          <button className={styles.addButton} onClick={() => setShowAddModal(true)}>
            Add Requirement
          </button>
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
                    {(req.status === 'pending' || req.status === 'failed') && (
                      <button
                        className={`${styles.actionButton} ${styles.primary}`}
                        onClick={() => handleRun(req.id)}
                        disabled={runMutation.isPending}
                      >
                        {req.status === 'failed' ? 'Retry' : 'Run'}
                      </button>
                    )}
                    <button
                      className={styles.actionButton}
                      onClick={() => handleEdit(req)}
                    >
                      Edit
                    </button>
                    <button
                      className={`${styles.actionButton} ${styles.danger}`}
                      onClick={() => handleDelete(req.id)}
                      disabled={deleteMutation.isPending || req.status === 'in_progress'}
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

      {/* Floating Add Button */}
      <button className={styles.fab} onClick={() => setShowAddModal(true)}>
        +
      </button>

      {/* Add Requirement Modal */}
      {showAddModal && (
        <div className={styles.modalOverlay} onClick={() => setShowAddModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>Add Requirement</h3>
            <textarea
              className={styles.modalInput}
              placeholder="Describe the requirement..."
              value={newReqText}
              onChange={(e) => setNewReqText(e.target.value)}
              rows={4}
              autoFocus
            />
            <div className={styles.prioritySection}>
              <label className={styles.priorityLabel}>
                Priority: {newReqPriority}
              </label>
              <input
                type="range"
                min="0"
                max="10"
                value={newReqPriority}
                onChange={(e) => setNewReqPriority(parseInt(e.target.value))}
                className={styles.prioritySlider}
              />
            </div>
            <div className={styles.modalActions}>
              <button
                className={styles.modalCancel}
                onClick={() => setShowAddModal(false)}
              >
                Cancel
              </button>
              <button
                className={styles.modalSubmit}
                onClick={handleCreate}
                disabled={!newReqText.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? 'Adding...' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
