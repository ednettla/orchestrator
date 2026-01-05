/**
 * Confirm Component
 *
 * Yes/No confirmation dialog overlay.
 *
 * @module ui/components/Confirm
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { colors, icons, borders } from '../styles.js';

interface ConfirmProps {
  message: string;
  onConfirm: (confirmed: boolean) => void;
  destructive?: boolean | undefined;
  defaultValue?: boolean | undefined;
  confirmLabel?: string | undefined;
  cancelLabel?: string | undefined;
}

export function Confirm({
  message,
  onConfirm,
  destructive = false,
  defaultValue = true,
  confirmLabel = 'Yes',
  cancelLabel = 'No',
}: ConfirmProps): React.ReactElement {
  const [selected, setSelected] = useState<boolean>(destructive ? false : defaultValue);

  useInput((input, key) => {
    if (key.leftArrow || input === 'h') {
      setSelected(true);
    } else if (key.rightArrow || input === 'l') {
      setSelected(false);
    } else if (input === 'y' || input === 'Y') {
      onConfirm(true);
    } else if (input === 'n' || input === 'N') {
      onConfirm(false);
    } else if (key.return) {
      onConfirm(selected);
    } else if (key.escape) {
      onConfirm(false);
    }
  });

  const yesColor = selected ? (destructive ? colors.error : colors.success) : colors.muted;
  const noColor = !selected ? colors.success : colors.muted;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        {destructive && <Text color={colors.warning}>{icons.warning} </Text>}
        <Text bold color={colors.text}>{message}</Text>
      </Box>
      <Box gap={2}>
        <Box>
          <Text color={yesColor}>
            {selected ? `${icons.pointer} ` : '  '}
          </Text>
          <Text color={yesColor} bold={selected}>{confirmLabel}</Text>
        </Box>
        <Box>
          <Text color={noColor}>
            {!selected ? `${icons.pointer} ` : '  '}
          </Text>
          <Text color={noColor} bold={!selected}>{cancelLabel}</Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color={colors.muted}>
          {icons.arrowLeft}/{icons.arrowRight} to select, Enter to confirm, y/n for quick response
        </Text>
      </Box>
    </Box>
  );
}
