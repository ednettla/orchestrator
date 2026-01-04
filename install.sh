#!/bin/bash

# Orchestrator Installation Script
# This script installs the orchestrator CLI tool globally
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ednettla/orchestrator/main/install.sh | bash
#
# Or from a cloned repo:
#   ./install.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

REPO_URL="https://github.com/ednettla/orchestrator.git"
INSTALL_DIR="${HOME}/.orchestrator-cli"

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║           Orchestrator Installation Script                ║"
echo "║     Multi-agent CLI for building web applications         ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# -----------------------------------------------------------------------------
# Check Prerequisites
# -----------------------------------------------------------------------------

echo -e "${YELLOW}Checking prerequisites...${NC}"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed${NC}"
    echo "Please install Node.js 20+ from https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo -e "${RED}Error: Node.js version 20+ required (found v$NODE_VERSION)${NC}"
    echo "Please upgrade Node.js from https://nodejs.org"
    exit 1
fi
echo -e "${GREEN}✓ Node.js v$(node -v | cut -d'v' -f2)${NC}"

# Check npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}Error: npm is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ npm v$(npm -v)${NC}"

# Check git
if ! command -v git &> /dev/null; then
    echo -e "${RED}Error: git is not installed${NC}"
    echo "Please install git from https://git-scm.com"
    exit 1
fi
echo -e "${GREEN}✓ git installed${NC}"

# -----------------------------------------------------------------------------
# Determine Source Directory
# -----------------------------------------------------------------------------

# Check if we're running from a cloned repo or via curl
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}" 2>/dev/null)" 2>/dev/null && pwd)" || SCRIPT_DIR=""

if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/package.json" ]; then
    echo ""
    echo -e "${YELLOW}Installing from local directory: ${SCRIPT_DIR}${NC}"
    SOURCE_DIR="$SCRIPT_DIR"
else
    echo ""
    echo -e "${YELLOW}Cloning repository...${NC}"

    # Create temp directory for cloning
    TEMP_DIR=$(mktemp -d)
    trap "rm -rf $TEMP_DIR" EXIT

    git clone --depth 1 "$REPO_URL" "$TEMP_DIR"
    SOURCE_DIR="$TEMP_DIR"
fi

# -----------------------------------------------------------------------------
# Installation Directory
# -----------------------------------------------------------------------------

echo ""
echo -e "${YELLOW}Installation directory: ${INSTALL_DIR}${NC}"

IS_UPDATE=false

# Check if this is an update or fresh install
if [ -d "$INSTALL_DIR" ] && [ -d "$INSTALL_DIR/.git" ]; then
    IS_UPDATE=true
    echo -e "${YELLOW}Existing installation found. Updating...${NC}"

    cd "$INSTALL_DIR"

    # Get current version before update
    OLD_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")

    # Pull latest changes
    git fetch origin main
    git reset --hard origin/main

    echo -e "${GREEN}✓ Updated from git${NC}"
elif [ -d "$INSTALL_DIR" ]; then
    # Old installation without git, remove and reinstall
    echo -e "${YELLOW}Reinstalling (old format detected)...${NC}"
    rm -rf "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR"

    # Clone fresh
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
else
    # Fresh install
    echo -e "${YELLOW}Fresh installation...${NC}"
    mkdir -p "$INSTALL_DIR"

    # Clone the repository (keeping .git for future updates)
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# Show version info
NEW_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")
if [ "$IS_UPDATE" = true ] && [ -n "$OLD_VERSION" ]; then
    echo -e "${GREEN}Version: ${OLD_VERSION} → ${NEW_VERSION}${NC}"
else
    echo -e "${GREEN}Version: ${NEW_VERSION}${NC}"
fi

# -----------------------------------------------------------------------------
# Install Dependencies
# -----------------------------------------------------------------------------

echo ""
echo -e "${YELLOW}Installing dependencies...${NC}"
npm install

# -----------------------------------------------------------------------------
# Build
# -----------------------------------------------------------------------------

echo ""
echo -e "${YELLOW}Building CLI...${NC}"
npm run build

# Make CLI executable
chmod +x dist/cli/index.js

# -----------------------------------------------------------------------------
# Build WebApp
# -----------------------------------------------------------------------------

echo ""
echo -e "${YELLOW}Building Telegram Mini App...${NC}"

if [ -d "webapp" ]; then
    cd webapp

    # Install webapp dependencies
    echo -e "${YELLOW}Installing webapp dependencies...${NC}"
    npm install

    # Build webapp
    echo -e "${YELLOW}Compiling webapp...${NC}"
    npm run build

    cd ..
    echo -e "${GREEN}✓ Telegram Mini App built${NC}"
else
    echo -e "${YELLOW}Webapp directory not found, skipping...${NC}"
fi

# -----------------------------------------------------------------------------
# Link Globally
# -----------------------------------------------------------------------------

echo ""
echo -e "${YELLOW}Linking globally...${NC}"

# Check if we need sudo for npm link
NPM_PREFIX=$(npm prefix -g)
if [ -w "$NPM_PREFIX/lib/node_modules" ] 2>/dev/null || [ -w "$NPM_PREFIX" ] 2>/dev/null; then
    npm link
elif command -v sudo &> /dev/null; then
    echo -e "${YELLOW}Elevated permissions required for global install...${NC}"
    sudo npm link
else
    echo -e "${YELLOW}Cannot write to npm global directory. Creating local symlink...${NC}"
    # Fallback: add to user's local bin
    mkdir -p "$HOME/.local/bin"
    ln -sf "$INSTALL_DIR/dist/cli/index.js" "$HOME/.local/bin/orchestrate"
    echo -e "${YELLOW}Added orchestrate to ~/.local/bin${NC}"
    echo "Make sure ~/.local/bin is in your PATH"
fi

# Verify installation
if command -v orchestrate &> /dev/null; then
    echo -e "${GREEN}✓ 'orchestrate' command installed${NC}"
else
    echo -e "${YELLOW}Note: You may need to add npm global bin to your PATH${NC}"
    echo "  Add this to your ~/.bashrc or ~/.zshrc:"
    echo "  export PATH=\"\$(npm prefix -g)/bin:\$PATH\""
    echo "  OR: export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

# -----------------------------------------------------------------------------
# Claude Code Setup
# -----------------------------------------------------------------------------

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}                   Claude Code Setup                        ${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# Check if Claude Code CLI is installed
if ! command -v claude &> /dev/null; then
    echo ""
    echo -e "${YELLOW}Claude Code CLI not found. Installing...${NC}"
    npm install -g @anthropic-ai/claude-code
fi

if command -v claude &> /dev/null; then
    echo -e "${GREEN}✓ Claude Code CLI installed${NC}"

    # Check authentication
    echo ""
    echo -e "${YELLOW}Checking Claude Code authentication...${NC}"

    # Try to check auth status
    if claude --version &> /dev/null; then
        echo -e "${GREEN}✓ Claude Code CLI is available${NC}"
        echo ""
        echo -e "${YELLOW}To authenticate Claude Code, run:${NC}"
        echo -e "  ${GREEN}claude${NC}"
        echo ""
        echo "This will open a browser for authentication if needed."
    fi
else
    echo -e "${RED}Could not install Claude Code CLI${NC}"
    echo "Please install manually: npm install -g @anthropic-ai/claude-code"
fi

# -----------------------------------------------------------------------------
# Chrome Extension Setup
# -----------------------------------------------------------------------------

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}              Chrome MCP Extension Setup                    ${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "For browser automation, install the Claude Chrome extension:"
echo ""
echo -e "  1. Open Chrome and go to: ${GREEN}chrome://extensions${NC}"
echo -e "  2. Search for 'Claude' in the Chrome Web Store"
echo -e "  3. Install the official Claude extension"
echo -e "  4. Sign in with your Anthropic account"
echo ""
echo "The Chrome MCP tools will be available automatically."

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
if [ "$IS_UPDATE" = true ]; then
    echo -e "${GREEN}                   Update Complete!                         ${NC}"
else
    echo -e "${GREEN}                 Installation Complete!                     ${NC}"
fi
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "Quick Start:"
echo ""
echo -e "  ${GREEN}orchestrate init${NC}              # Initialize a new project"
echo -e "  ${GREEN}orchestrate plan \"Build X\"${NC}   # Create a project plan"
echo -e "  ${GREEN}orchestrate run${NC}               # Execute requirements"
echo -e "  ${GREEN}orchestrate --help${NC}            # Show all commands"
echo ""
echo "Updates:"
echo ""
echo -e "  ${GREEN}orchestrate update${NC}            # Update to latest version"
echo -e "  ${GREEN}orchestrate update --check${NC}    # Check for updates"
echo ""
echo "Documentation: See README.md in $INSTALL_DIR"
echo ""

# Check if shell needs to be reloaded
if ! command -v orchestrate &> /dev/null; then
    echo -e "${YELLOW}Note: Restart your terminal or run:${NC}"
    echo "  source ~/.bashrc  # or ~/.zshrc"
    echo ""
fi
