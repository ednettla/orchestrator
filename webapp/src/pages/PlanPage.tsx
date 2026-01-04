/**
 * Plan Page
 *
 * View and manage project plans with Q&A flow.
 */

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useTelegram } from '../hooks/useTelegram';
import styles from './PlanPage.module.css';

interface Question {
  id: string;
  question: string;
  context?: string;
  answer?: string;
  answeredAt?: string;
}

interface Plan {
  id: string;
  status: string;
  highLevelGoal: string;
  overview?: string;
  questions: Question[];
  requirements?: string[];
  architecturalDecisions?: string[];
  risks?: string[];
}

interface PlanResponse {
  success: boolean;
  plan: Plan | null;
  hasActivePlan: boolean;
  hasPendingQuestions: boolean;
  pendingQuestions: Question[];
}

export default function PlanPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const { haptic, showConfirm } = useTelegram();

  const [answerText, setAnswerText] = useState('');
  const [answeringId, setAnsweringId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['plan', projectId],
    queryFn: async () => {
      const response = await api.get<PlanResponse>(`/projects/${projectId}/plans/active`);
      if (!response.success) {
        throw new Error(response.error?.message ?? 'Failed to load plan');
      }
      return response.data!;
    },
  });

  const answerMutation = useMutation({
    mutationFn: async ({ questionId, answer }: { questionId: string; answer: string }) => {
      const response = await api.post(`/projects/${projectId}/plans/answer`, {
        questionId,
        answer,
      });
      if (!response.success) {
        throw new Error(response.error?.message ?? 'Failed to submit answer');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plan', projectId] });
      setAnsweringId(null);
      setAnswerText('');
      haptic?.notificationOccurred('success');
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(`/projects/${projectId}/plans/approve`);
      if (!response.success) {
        throw new Error(response.error?.message ?? 'Failed to approve');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plan', projectId] });
      haptic?.notificationOccurred('success');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(`/projects/${projectId}/plans/reject`);
      if (!response.success) {
        throw new Error(response.error?.message ?? 'Failed to reject');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plan', projectId] });
    },
  });

  const handleAnswer = (question: Question) => {
    setAnsweringId(question.id);
    setAnswerText('');
    haptic?.selectionChanged();
  };

  const submitAnswer = () => {
    if (answeringId && answerText.trim()) {
      answerMutation.mutate({
        questionId: answeringId,
        answer: answerText.trim(),
      });
    }
  };

  const handleApprove = async () => {
    const confirmed = await showConfirm('Approve this plan and start execution?');
    if (confirmed) {
      approveMutation.mutate();
    }
  };

  const handleReject = async () => {
    const confirmed = await showConfirm('Reject this plan?');
    if (confirmed) {
      rejectMutation.mutate();
    }
  };

  if (isLoading) {
    return <div className={styles.loading}>Loading plan...</div>;
  }

  if (error) {
    return <div className={styles.error}>Failed to load plan</div>;
  }

  if (!data?.hasActivePlan) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>📝</div>
        <h2>No Active Plan</h2>
        <p>Start planning from the Telegram bot using the plan command.</p>
      </div>
    );
  }

  const { plan, pendingQuestions } = data;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>Plan</h2>
        <span className={`${styles.statusBadge} ${styles[plan!.status]}`}>
          {plan!.status}
        </span>
      </div>

      <div className={styles.goal}>
        <h3>Goal</h3>
        <p>{plan!.highLevelGoal}</p>
      </div>

      {plan!.overview && (
        <div className={styles.section}>
          <h3>Overview</h3>
          <p>{plan!.overview}</p>
        </div>
      )}

      {pendingQuestions.length > 0 && (
        <div className={styles.questionsSection}>
          <h3>Pending Questions ({pendingQuestions.length})</h3>
          <div className={styles.questionsList}>
            {pendingQuestions.map((q) => (
              <div key={q.id} className={styles.questionCard}>
                <p className={styles.questionText}>{q.question}</p>
                {q.context && <p className={styles.questionContext}>{q.context}</p>}

                {answeringId === q.id ? (
                  <div className={styles.answerForm}>
                    <textarea
                      value={answerText}
                      onChange={(e) => setAnswerText(e.target.value)}
                      placeholder="Your answer..."
                      className={styles.answerInput}
                      rows={3}
                    />
                    <div className={styles.answerActions}>
                      <button
                        className={styles.submitButton}
                        onClick={submitAnswer}
                        disabled={answerMutation.isPending}
                      >
                        Submit
                      </button>
                      <button
                        className={styles.cancelButton}
                        onClick={() => setAnsweringId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className={styles.answerButton}
                    onClick={() => handleAnswer(q)}
                  >
                    Answer
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {plan!.requirements && plan!.requirements.length > 0 && (
        <div className={styles.section}>
          <h3>Requirements ({plan!.requirements.length})</h3>
          <ul className={styles.list}>
            {plan!.requirements.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {pendingQuestions.length === 0 && plan!.status === 'pending_approval' && (
        <div className={styles.approvalActions}>
          <button
            className={styles.approveButton}
            onClick={handleApprove}
            disabled={approveMutation.isPending}
          >
            Approve Plan
          </button>
          <button
            className={styles.rejectButton}
            onClick={handleReject}
            disabled={rejectMutation.isPending}
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
