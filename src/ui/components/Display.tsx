/**
 * Display Component
 *
 * Shows formatted messages (info, success, warning, error).
 * Waits for user to press Enter to continue.
 *
 * @module ui/components/Display
 */

import React from 'react';
import { Box, Text, useInput } from 'ink';
import { colors, icons } from '../styles.js';

export type DisplayFormat = 'info' | 'success' | 'warning' | 'error';

interface DisplayProps {
  message: string;
  format?: DisplayFormat | undefined;
  onContinue?: (() => void) | undefined;
}

export function Display({ message, format = 'info', onContinue }: DisplayProps): React.ReactElement {
  let icon: string;
  let color: string;

  switch (format) {
    case 'success':
      icon = icons.success;
      color = colors.success;
      break;
    case 'warning':
      icon = icons.warning;
      color = colors.warning;
      break;
    case 'error':
      icon = icons.error;
      color = colors.error;
      break;
    default:
      icon = icons.info;
      color = colors.primary;
  }

  // Handle Enter or Escape key to continue
  useInput((input, key) => {
    if ((key.return || key.escape) && onContinue) {
      onContinue();
    }
  });

  // Split message by newlines to render each line
  const lines = message.split('\n');

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box flexDirection="column">
        {lines.map((line, index) => (
          <Box key={index}>
            {index === 0 && <Text color={color}>{icon} </Text>}
            {index > 0 && <Text>   </Text>}
            <Text color={color}>{line}</Text>
          </Box>
        ))}
      </Box>
      {onContinue && (
        <Box marginTop={1}>
          <Text color={colors.muted}>Press Enter or Esc to continue...</Text>
        </Box>
      )}
    </Box>
  );
}
