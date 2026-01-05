/**
 * Header Component
 *
 * Title bar for the full-screen TUI showing app name and project info.
 *
 * @module ui/components/Header
 */

import React from 'react';
import { Box, Text } from 'ink';
import { colors, borders, icons } from '../styles.js';

interface HeaderProps {
  projectName?: string | undefined;
  version?: string | undefined;
  status?: 'idle' | 'running' | 'error' | undefined;
}

export function Header({ projectName, version = '0.1.15', status }: HeaderProps): React.ReactElement {
  const statusIndicator = status === 'running'
    ? <Text color={colors.success}>{icons.running}</Text>
    : status === 'error'
      ? <Text color={colors.error}>{icons.error}</Text>
      : null;

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between" paddingX={1}>
        <Box>
          <Text bold color={colors.primary}>ORCHESTRATOR</Text>
          <Text color={colors.muted}> v{version}</Text>
          {statusIndicator && <Text> </Text>}
          {statusIndicator}
        </Box>
        {projectName && (
          <Text color={colors.muted}>[{projectName}]</Text>
        )}
      </Box>
      <Box paddingX={1}>
        <Text color={colors.border}>{borders.horizontal.repeat(60)}</Text>
      </Box>
    </Box>
  );
}
