/**
 * Error Boundary Component
 *
 * Catches React errors and displays a friendly error message
 * instead of crashing the entire TUI.
 *
 * @module ui/components/ErrorBoundary
 */

import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { Box, Text } from 'ink';
import { colors, icons } from '../styles.js';

interface ErrorBoundaryProps {
  children: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log to console for debugging
    console.error('TUI Error:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <Box flexDirection="column" paddingX={1}>
          <Box marginBottom={1}>
            <Text color={colors.error} bold>
              {icons.error} An error occurred
            </Text>
          </Box>
          <Box>
            <Text color={colors.error}>
              {this.state.error?.message ?? 'Unknown error'}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color={colors.muted}>
              Press Ctrl+C to exit
            </Text>
          </Box>
        </Box>
      );
    }

    return this.props.children;
  }
}
