/**
 * TUI App Shell
 *
 * Main full-screen application component for the Orchestrator CLI.
 * Renders the appropriate view based on current app state.
 *
 * @module ui/App
 */

import React, { useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { FullScreenBox } from 'fullscreen-ink';
import { Header, Footer, Menu, TextInput, Confirm, Spinner, Display, ErrorBoundary } from './components/index.js';
import type { AppState, AppStateActions, ViewState } from './hooks/useAppState.js';
import type { MenuItem } from './components/Menu.js';
import { colors, icons } from './styles.js';

// ============================================================================
// Props
// ============================================================================

interface AppProps {
  state: AppState;
  actions: AppStateActions;
}

// ============================================================================
// View Components
// ============================================================================

interface ViewRendererProps {
  view: ViewState;
  error?: string | undefined;
}

function ViewRenderer({ view, error }: ViewRendererProps): React.ReactElement | null {
  // Show error overlay if present
  if (error) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text color={colors.error}>{icons.error} Error</Text>
        </Box>
        <Box>
          <Text color={colors.error}>{error}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={colors.muted}>Press any key to continue...</Text>
        </Box>
      </Box>
    );
  }

  switch (view.type) {
    case 'menu': {
      const items: MenuItem[] = view.interaction.options.map((opt) => ({
        id: opt.id,
        label: opt.label,
        icon: opt.icon,
        description: opt.description,
        disabled: opt.disabled,
        disabledReason: opt.disabledReason,
      }));

      return (
        <Menu
          items={items}
          message={view.interaction.message}
          onSelect={(id) => view.resolve(id)}
          onCancel={() => view.resolve(null)}
        />
      );
    }

    case 'input':
      return (
        <TextInput
          message={view.interaction.message}
          placeholder={view.interaction.placeholder}
          multiline={view.interaction.multiline}
          onSubmit={(value) => view.resolve(value)}
          onCancel={() => view.resolve(null)}
          validate={view.interaction.validate}
        />
      );

    case 'confirm':
      return (
        <Confirm
          message={view.interaction.message}
          onConfirm={(confirmed) => view.resolve(confirmed)}
          destructive={view.interaction.destructive}
          confirmLabel={view.interaction.confirmLabel}
          cancelLabel={view.interaction.cancelLabel}
        />
      );

    case 'progress':
      return <Spinner message={view.message} state={view.state} />;

    case 'display':
      return (
        <Display
          message={view.message}
          format={view.format}
          onContinue={() => view.resolve()}
        />
      );

    case 'idle':
    default:
      return (
        <Box paddingX={1}>
          <Text color={colors.muted}>Ready...</Text>
        </Box>
      );
  }
}

// ============================================================================
// Footer Shortcuts
// ============================================================================

function getShortcuts(view: ViewState, hasError: boolean): Array<{ key: string; label: string }> {
  if (hasError) {
    return [{ key: 'any key', label: 'Continue' }];
  }

  switch (view.type) {
    case 'menu':
      return [
        { key: 'j/k', label: 'Navigate' },
        { key: 'Enter', label: 'Select' },
        { key: 'Esc', label: 'Back' },
        { key: 'q', label: 'Quit' },
      ];
    case 'input': {
      const inputView = view as { interaction: { multiline?: boolean } };
      if (inputView.interaction.multiline) {
        return [
          { key: 'Enter', label: 'New line' },
          { key: 'Ctrl+Enter', label: 'Submit' },
          { key: 'Esc', label: 'Cancel' },
        ];
      }
      return [
        { key: 'Enter', label: 'Submit' },
        { key: 'Esc', label: 'Cancel' },
      ];
    }
    case 'confirm':
      return [
        { key: '\u2190/\u2192', label: 'Select' },
        { key: 'y/n', label: 'Quick' },
        { key: 'Enter', label: 'Confirm' },
      ];
    case 'display':
      return [
        { key: 'Enter', label: 'Continue' },
        { key: 'Esc', label: 'Continue' },
      ];
    case 'progress':
      return [{ key: 'Ctrl+C', label: 'Cancel' }];
    default:
      return [{ key: 'q', label: 'Quit' }];
  }
}

// ============================================================================
// Main App Component
// ============================================================================

export function App({ state, actions }: AppProps): React.ReactElement {
  const { exit } = useApp();

  // Handle global keyboard shortcuts
  useInput((input, key) => {
    // Clear error on any key
    if (state.error) {
      actions.setError(undefined);
      return;
    }

    // Handle 'q' to quit when not in input mode
    if (input === 'q' && state.view.type !== 'input' && state.view.type !== 'display') {
      actions.exit();
    }

    // Handle Ctrl+C
    if (key.ctrl && input === 'c') {
      actions.exit();
    }
  });

  // Exit the app when exiting flag is set
  useEffect(() => {
    if (state.exiting) {
      exit();
    }
  }, [state.exiting, exit]);

  const shortcuts = getShortcuts(state.view, !!state.error);

  return (
    <ErrorBoundary>
      <FullScreenBox flexDirection="column">
        <Header projectName={state.projectName} />

        <Box flexGrow={1} flexDirection="column" paddingY={1}>
          <ViewRenderer view={state.view} error={state.error} />
        </Box>

        <Footer shortcuts={shortcuts} />
      </FullScreenBox>
    </ErrorBoundary>
  );
}
