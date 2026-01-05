/**
 * Display Component
 *
 * Shows formatted messages (info, success, warning, error).
 *
 * @module ui/components/Display
 */

import React from 'react';
import { Box, Text } from 'ink';
import { colors, icons } from '../styles.js';

export type DisplayFormat = 'info' | 'success' | 'warning' | 'error';

interface DisplayProps {
  message: string;
  format?: DisplayFormat | undefined;
}

export function Display({ message, format = 'info' }: DisplayProps): React.ReactElement {
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

  return (
    <Box paddingX={1}>
      <Text color={color}>{icon} </Text>
      <Text color={color}>{message}</Text>
    </Box>
  );
}
