import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import Spinner from 'ink-spinner';
import type { Requirement, Job, Session } from '../core/types.js';
import type { StateStore } from '../state/store.js';

interface DashboardProps {
  store: StateStore;
  session: Session;
}

function Dashboard({ store, session }: DashboardProps): React.ReactElement {
  const { exit } = useApp();
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Poll for updates
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

  // Handle keyboard input
  useInput((input, key) => {
    if (input === 'q') {
      exit();
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(requirements.length - 1, i + 1));
    }
  });

  // Group requirements by status
  const inProgress = requirements.filter((r) => r.status === 'in_progress');
  const pending = requirements.filter((r) => r.status === 'pending');
  const completed = requirements.filter((r) => r.status === 'completed');
  const failed = requirements.filter((r) => r.status === 'failed');

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">ORCHESTRATOR DASHBOARD</Text>
        <Box marginLeft={2}>
          <Text dimColor>[q]uit</Text>
        </Box>
      </Box>

      {/* Session Info */}
      <Box marginBottom={1}>
        <Text dimColor>Project: </Text>
        <Text>{session.projectName}</Text>
        <Box marginLeft={2}>
          <Text dimColor>Status: </Text>
          <Text color={session.status === 'active' ? 'green' : 'yellow'}>{session.status}</Text>
        </Box>
      </Box>

      {/* Divider */}
      <Box marginBottom={1}>
        <Text dimColor>{'─'.repeat(60)}</Text>
      </Box>

      {/* Requirements */}
      <Box flexDirection="column">
        <Text bold>REQUIREMENTS</Text>

        {/* In Progress */}
        {inProgress.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="yellow">● In Progress ({inProgress.length})</Text>
            {inProgress.map((req) => (
              <RequirementRow key={req.id} requirement={req} job={jobs.find((j) => j.requirementId === req.id)} />
            ))}
          </Box>
        )}

        {/* Pending */}
        {pending.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="blue">○ Pending ({pending.length})</Text>
            {pending.map((req) => (
              <RequirementRow key={req.id} requirement={req} />
            ))}
          </Box>
        )}

        {/* Completed */}
        {completed.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="green">✓ Completed ({completed.length})</Text>
            {completed.map((req) => (
              <RequirementRow key={req.id} requirement={req} />
            ))}
          </Box>
        )}

        {/* Failed */}
        {failed.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="red">✗ Failed ({failed.length})</Text>
            {failed.map((req) => (
              <RequirementRow key={req.id} requirement={req} />
            ))}
          </Box>
        )}

        {/* Empty state */}
        {requirements.length === 0 && (
          <Box marginTop={1}>
            <Text dimColor>No requirements found. Use 'orchestrate add' to add one.</Text>
          </Box>
        )}
      </Box>

      {/* Divider */}
      <Box marginY={1}>
        <Text dimColor>{'─'.repeat(60)}</Text>
      </Box>

      {/* Summary */}
      <Box>
        <Text dimColor>Total: </Text>
        <Text>{pending.length} pending, {inProgress.length} running, {completed.length} done, {failed.length} failed</Text>
      </Box>
    </Box>
  );
}

interface RequirementRowProps {
  requirement: Requirement;
  job?: Job | undefined;
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

export function renderDashboard(store: StateStore, session: Session): void {
  render(<Dashboard store={store} session={session} />);
}
