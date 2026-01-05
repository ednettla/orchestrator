/**
 * Menu Component
 *
 * Arrow-navigable menu with icon support and disabled items.
 *
 * @module ui/components/Menu
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { colors, icons } from '../styles.js';

export interface MenuItem {
  id: string;
  label: string;
  icon?: string | undefined;
  description?: string | undefined;
  disabled?: boolean | undefined;
  disabledReason?: string | undefined;
}

interface MenuProps {
  items: MenuItem[];
  message?: string | undefined;
  onSelect: (id: string) => void;
  onCancel?: (() => void) | undefined;
  initialIndex?: number | undefined;
}

export function Menu({
  items,
  message,
  onSelect,
  onCancel,
  initialIndex = 0,
}: MenuProps): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);

  // Find first non-disabled item if initial is disabled
  useEffect(() => {
    const enabledItems = items.filter((item) => !item.disabled);
    if (enabledItems.length === 0) return;

    if (items[selectedIndex]?.disabled) {
      const firstEnabledIndex = items.findIndex((item) => !item.disabled);
      if (firstEnabledIndex >= 0) {
        setSelectedIndex(firstEnabledIndex);
      }
    }
  }, [items, selectedIndex]);

  const moveUp = useCallback(() => {
    setSelectedIndex((current) => {
      let next = current - 1;
      while (next >= 0 && items[next]?.disabled) {
        next--;
      }
      return next >= 0 ? next : current;
    });
  }, [items]);

  const moveDown = useCallback(() => {
    setSelectedIndex((current) => {
      let next = current + 1;
      while (next < items.length && items[next]?.disabled) {
        next++;
      }
      return next < items.length ? next : current;
    });
  }, [items]);

  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      moveUp();
    } else if (key.downArrow || input === 'j') {
      moveDown();
    } else if (key.return) {
      const item = items[selectedIndex];
      if (item && !item.disabled) {
        onSelect(item.id);
      }
    } else if (key.escape && onCancel) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      {message && (
        <Box marginBottom={1}>
          <Text bold color={colors.text}>{message}</Text>
        </Box>
      )}
      {items.map((item, index) => {
        const isSelected = index === selectedIndex;
        const isDisabled = item.disabled;

        let textColor: string = colors.text;
        if (isDisabled) {
          textColor = colors.disabled;
        } else if (isSelected) {
          textColor = colors.selected;
        }

        return (
          <Box key={item.id} flexDirection="column">
            <Box>
              <Text color={isSelected ? colors.selected : colors.muted}>
                {isSelected ? `${icons.pointer} ` : '  '}
              </Text>
              {item.icon && <Text>{item.icon} </Text>}
              <Text color={textColor}>{item.label}</Text>
              {isDisabled && item.disabledReason && (
                <Text color={colors.disabled}> ({item.disabledReason})</Text>
              )}
            </Box>
            {item.description && isSelected && !isDisabled && (
              <Box marginLeft={4}>
                <Text color={colors.muted}>{item.description}</Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
