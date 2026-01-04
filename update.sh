#!/bin/bash

# Orchestrator Update Script
# Quick update for existing installations

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

INSTALL_DIR="${HOME}/.orchestrator-cli"

echo -e "${YELLOW}Updating Orchestrator...${NC}"

if [ ! -d "$INSTALL_DIR/.git" ]; then
    echo -e "${RED}Error: No installation found at $INSTALL_DIR${NC}"
    echo "Run install.sh for fresh installation"
    exit 1
fi

cd "$INSTALL_DIR"

# Get current version
OLD_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")

# Reset any local changes and pull
git fetch origin main
git reset --hard origin/main

# Get new version
NEW_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")

echo -e "${GREEN}Version: ${OLD_VERSION} → ${NEW_VERSION}${NC}"

# Rebuild
echo -e "${YELLOW}Installing dependencies...${NC}"
npm install

echo -e "${YELLOW}Building CLI...${NC}"
npm run build
chmod +x dist/cli/index.js

# Build webapp
if [ -d "webapp" ]; then
    echo -e "${YELLOW}Building webapp...${NC}"
    cd webapp
    npm install
    npm run build
    cd ..
fi

echo -e "${GREEN}Update complete!${NC}"
