/**
 * Spinner Component
 *
 * Progress indicator with message and optional success/fail states.
 *
 * @module ui/components/Spinner
 */

import React from 'react';
import { Box, Text } from 'ink';
import InkSpinner from 'ink-spinner';
import { colors, icons } from '../styles.js';

type SpinnerState = 'spinning' | 'success' | 'error';

interface SpinnerProps {
  message: string;
  state?: SpinnerState | undefined;
}

export function Spinner({ message, state = 'spinning' }: SpinnerProps): React.ReactElement {
  let indicator: React.ReactElement;
  let textColor: string = colors.text;

  switch (state) {
    case 'success':
      indicator = <Text color={colors.success}>{icons.success}</Text>;
      textColor = colors.success;
      break;
    case 'error':
      indicator = <Text color={colors.error}>{icons.error}</Text>;
      textColor = colors.error;
      break;
    default:
      indicator = (
        <Text color={colors.primary}>
          <InkSpinner type="dots" />
        </Text>
      );
  }

  return (
    <Box paddingX={1}>
      {indicator}
      <Text> </Text>
      <Text color={textColor}>{message}</Text>
    </Box>
  );
}
