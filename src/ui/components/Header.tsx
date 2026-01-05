/**
 * Header Component
 *
 * Title bar for the full-screen TUI showing app name and project info.
 *
 * @module ui/components/Header
 */

import React from 'react';
import { Box, Text } from 'ink';
import { useScreenSize } from 'fullscreen-ink';
import { colors, borders, icons } from '../styles.js';

// Read version from package.json at build time
const VERSION = process.env['npm_package_version'] ?? '0.1.x';

interface HeaderProps {
  projectName?: string | undefined;
  version?: string | undefined;
  status?: 'idle' | 'running' | 'error' | undefined;
}

export function Header({ projectName, version = VERSION, status }: HeaderProps): React.ReactElement {
  const { width } = useScreenSize();
  const dividerWidth = Math.max(20, width - 4); // Account for padding

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
        <Text color={colors.border}>{borders.horizontal.repeat(dividerWidth)}</Text>
      </Box>
    </Box>
  );
}
