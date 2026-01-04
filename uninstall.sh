#!/bin/bash

# Orchestrator Uninstall Script

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Orchestrator Uninstall Script${NC}"
echo ""

INSTALL_DIR="${HOME}/.orchestrator-cli"

# Unlink global command
echo -e "${YELLOW}Unlinking global command...${NC}"
if [ -d "$INSTALL_DIR" ]; then
    cd "$INSTALL_DIR"
    npm unlink 2>/dev/null || true
fi

# Remove installation directory
if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}Removing installation directory...${NC}"
    rm -rf "$INSTALL_DIR"
    echo -e "${GREEN}✓ Removed $INSTALL_DIR${NC}"
else
    echo "Installation directory not found at $INSTALL_DIR"
fi

echo ""
echo -e "${GREEN}Orchestrator has been uninstalled.${NC}"
echo ""
echo "Note: This does not remove:"
echo "  - Claude Code CLI (npm uninstall -g @anthropic-ai/claude-code)"
echo "  - Project .orchestrator directories"
echo "  - Chrome extension"
