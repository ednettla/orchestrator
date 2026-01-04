import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import Spinner from 'ink-spinner';
import type { Requirement, Job, Session } from '../core/types.js';
import type { StateStore } from '../state/store.js';
import type { AgentMonitor, AgentActivity, ProgressInfo } from '../agents/monitor.js';

// ============================================================================
// Props Interfaces
// ============================================================================

interface DashboardProps {
  store: StateStore;
  session: Session;
  monitor?: AgentMonitor | undefined;
}

interface ActivityRowProps {
  activity: AgentActivity;
}

interface RequirementRowProps {
  requirement: Requirement;
  job?: Job | undefined;
}

interface ProgressBarProps {
  progress: ProgressInfo;
  width?: number;
}

// ============================================================================
// Helper Components
// ============================================================================

function ProgressBar({ progress, width = 40 }: ProgressBarProps): React.ReactElement {
  const filled = Math.round((progress.percentage / 100) * width);
  const empty = width - filled;

  return (
    <Box>
      <Text color="green">{'█'.repeat(filled)}</Text>
      <Text dimColor>{'░'.repeat(empty)}</Text>
      <Text dimColor> {progress.percentage}% ({progress.completed}/{progress.total})</Text>
    </Box>
  );
}

function formatElapsedTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${secs}s`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function ActivityRow({ activity }: ActivityRowProps): React.ReactElement {
  const truncatedTitle = activity.requirementTitle.length > 40
    ? activity.requirementTitle.substring(0, 40) + '...'
    : activity.requirementTitle;

  const elapsedSecs = Math.floor((Date.now() - activity.startedAt.getTime()) / 1000);
  const elapsed = formatElapsedTime(elapsedSecs);

  // Status indicator
  let statusIcon: React.ReactElement;
  let statusColor: string;
  switch (activity.status) {
    case 'stuck_warning':
      statusIcon = <Text color="yellow">⚠</Text>;
      statusColor = 'yellow';
      break;
    case 'retrying':
      statusIcon = <Text color="magenta">↻</Text>;
      statusColor = 'magenta';
      break;
    case 'completed':
      statusIcon = <Text color="green">✓</Text>;
      statusColor = 'green';
      break;
    case 'failed':
      statusIcon = <Text color="red">✗</Text>;
      statusColor = 'red';
      break;
    default:
      statusIcon = <Text color="blue">▶</Text>;
      statusColor = 'blue';
  }

  return (
    <Box flexDirection="column" marginLeft={2} marginBottom={1}>
      {/* Main row */}
      <Box>
        {statusIcon}
        <Text> </Text>
        <Text dimColor>{activity.jobId.substring(0, 8)} </Text>
        <Text>"{truncatedTitle}"</Text>
        {activity.retryCount > 0 && (
          <Text color="magenta"> (retry {activity.retryCount})</Text>
        )}
      </Box>

      {/* Phase and elapsed time */}
      <Box marginLeft={2}>
        <Text dimColor>Phase: </Text>
        <Text color={statusColor}>{activity.phase}</Text>
        <Text dimColor> ({elapsed})</Text>
      </Box>

      {/* Current tool call */}
      {activity.currentToolCall && (
        <Box marginLeft={2}>
          <Text color="cyan">[{activity.currentToolCall.name}]</Text>
          <Text dimColor> {activity.currentToolCall.args}</Text>
        </Box>
      )}

      {/* Thinking preview */}
      {activity.thinkingPreview && !activity.currentToolCall && (
        <Box marginLeft={2}>
          <Text color="gray">
            <Spinner type="dots" />
          </Text>
          <Text dimColor> {activity.thinkingPreview}</Text>
        </Box>
      )}
    </Box>
  );
}

function RequirementRow({ requirement, job }: RequirementRowProps): React.ReactElement {
  const truncated = requirement.rawInput.length > 50
    ? requirement.rawInput.substring(0, 50) + '...'
    : requirement.rawInput;

  return (
    <Box marginLeft={2}>
      <Text dimColor>{requirement.id.substring(0, 8)} </Text>
      <Text>{truncated}</Text>
      {job && (
        <Box marginLeft={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text dimColor> {job.phase}</Text>
        </Box>
      )}
    </Box>
  );
}

// ============================================================================
// Main Dashboard Component
// ============================================================================

function Dashboard({ store, session, monitor }: DashboardProps): React.ReactElement {
  const { exit } = useApp();
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [progress, setProgress] = useState<ProgressInfo>({ completed: 0, total: 0, percentage: 0 });
  const [elapsedTime, setElapsedTime] = useState(0);

  // Poll for store updates
  useEffect(() => {
    const refresh = (): void => {
      const reqs = store.getRequirementsBySession(session.id);
      const runningJobs = store.getRunningJobs(session.id);
      setRequirements(reqs);
      setJobs(runningJobs);
    };

    refresh();
    const interval = setInterval(refresh, 1000);
    return () => clearInterval(interval);
  }, [store, session.id]);

  // Subscribe to monitor events
  useEffect(() => {
    if (!monitor) return;

    const updateActivities = (): void => {
      setActivities(monitor.getActivities());
      setProgress(monitor.getOverallProgress());
      setElapsedTime(monitor.getElapsedTime());
    };

    // Initial update
    updateActivities();

    // Subscribe to activity events
    const onActivity = (): void => {
      updateActivities();
    };

    monitor.on('activity', onActivity);
    monitor.on('job_complete', onActivity);
    monitor.on('stuck_warning', onActivity);
    monitor.on('retry', onActivity);

    // Timer for elapsed time
    const timer = setInterval(() => {
      setElapsedTime(monitor.getElapsedTime());
    }, 1000);

    return () => {
      monitor.off('activity', onActivity);
      monitor.off('job_complete', onActivity);
      monitor.off('stuck_warning', onActivity);
      monitor.off('retry', onActivity);
      clearInterval(timer);
    };
  }, [monitor]);

  // Handle keyboard input
  useInput((input) => {
    if (input === 'q') {
      exit();
    }
  });

  // Group requirements by status
  const pending = requirements.filter((r) => r.status === 'pending');
  const completed = requirements.filter((r) => r.status === 'completed');
  const failed = requirements.filter((r) => r.status === 'failed');

  // Get active activities (running or warning)
  const activeActivities = activities.filter(
    (a) => a.status === 'running' || a.status === 'stuck_warning' || a.status === 'retrying'
  );

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1} justifyContent="space-between">
        <Text bold color="cyan">ORCHESTRATOR DASHBOARD</Text>
        <Text dimColor>[q]uit</Text>
      </Box>

      {/* Divider */}
      <Box marginBottom={1}>
        <Text dimColor>{'─'.repeat(60)}</Text>
      </Box>

      {/* Progress Section - Only show when monitor is active */}
      {monitor && (
        <>
          <Box marginBottom={1}>
            <Text dimColor>Phase: </Text>
            <Text bold color="yellow">{session.currentPhase?.toUpperCase() ?? 'IDLE'}</Text>
            <Box marginLeft={4}>
              <Text dimColor>Total: </Text>
              <Text>{formatElapsedTime(elapsedTime)}</Text>
            </Box>
          </Box>

          {progress.total > 0 && (
            <Box marginBottom={1}>
              <ProgressBar progress={progress} />
            </Box>
          )}

          {/* Divider */}
          <Box marginBottom={1}>
            <Text dimColor>{'─'.repeat(60)}</Text>
          </Box>
        </>
      )}

      {/* Active Jobs Section */}
      {activeActivities.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="yellow">ACTIVE JOBS ({activeActivities.length})</Text>
          {activeActivities.map((activity) => (
            <ActivityRow key={activity.jobId} activity={activity} />
          ))}
        </Box>
      )}

      {/* Fallback to store-based view when no monitor */}
      {!monitor && (
        <Box flexDirection="column">
          <Text bold>REQUIREMENTS</Text>

          {/* In Progress */}
          {requirements.filter(r => r.status === 'in_progress').map((req) => (
            <RequirementRow key={req.id} requirement={req} job={jobs.find((j) => j.requirementId === req.id)} />
          ))}

          {/* Pending */}
          {pending.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="blue">○ Pending ({pending.length})</Text>
              {pending.map((req) => (
                <RequirementRow key={req.id} requirement={req} />
              ))}
            </Box>
          )}
        </Box>
      )}

      {/* Divider */}
      <Box marginY={1}>
        <Text dimColor>{'─'.repeat(60)}</Text>
      </Box>

      {/* Summary Footer */}
      <Box>
        <Text color="blue">● Pending: {pending.length}</Text>
        <Text>  </Text>
        <Text color="green">✓ Completed: {completed.length}</Text>
        <Text>  </Text>
        <Text color="red">✗ Failed: {failed.length}</Text>
      </Box>

      {/* Empty state */}
      {requirements.length === 0 && (
        <Box marginTop={1}>
          <Text dimColor>No requirements found. Use 'orchestrate add' to add one.</Text>
        </Box>
      )}
    </Box>
  );
}

// ============================================================================
// Export
// ============================================================================

export function renderDashboard(store: StateStore, session: Session, monitor?: AgentMonitor): void {
  render(<Dashboard store={store} session={session} monitor={monitor} />);
}
