/**
 * Footer Component
 *
 * Keyboard shortcut hints at the bottom of the TUI.
 *
 * @module ui/components/Footer
 */

import React from 'react';
import { Box, Text } from 'ink';
import { colors, borders, icons } from '../styles.js';

interface Shortcut {
  key: string;
  label: string;
}

interface FooterProps {
  shortcuts?: Shortcut[] | undefined;
}

const defaultShortcuts: Shortcut[] = [
  { key: `${icons.arrowUp}/${icons.arrowDown}`, label: 'Navigate' },
  { key: 'Enter', label: 'Select' },
  { key: 'Esc', label: 'Back' },
  { key: 'q', label: 'Quit' },
];

export function Footer({ shortcuts = defaultShortcuts }: FooterProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box paddingX={1}>
        <Text color={colors.border}>{borders.horizontal.repeat(60)}</Text>
      </Box>
      <Box paddingX={1} gap={2}>
        {shortcuts.map((shortcut, index) => (
          <Box key={index}>
            <Text color={colors.highlight}>{shortcut.key}</Text>
            <Text color={colors.muted}> {shortcut.label}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
