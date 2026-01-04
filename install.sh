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

# Create or update installation directory
if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}Updating existing installation...${NC}"
    rm -rf "$INSTALL_DIR"
fi

echo -e "${YELLOW}Copying source files...${NC}"
mkdir -p "$INSTALL_DIR"

# Copy source files (excluding node_modules and dist to do fresh install)
if command -v rsync &> /dev/null; then
    rsync -a --exclude 'node_modules' --exclude 'dist' --exclude '.git' "$SOURCE_DIR/" "$INSTALL_DIR/"
else
    # Fallback without rsync
    cp -r "$SOURCE_DIR/src" "$INSTALL_DIR/"
    cp "$SOURCE_DIR/package.json" "$INSTALL_DIR/"
    cp "$SOURCE_DIR/package-lock.json" "$INSTALL_DIR/" 2>/dev/null || true
    cp "$SOURCE_DIR/tsconfig.json" "$INSTALL_DIR/"
    cp "$SOURCE_DIR/README.md" "$INSTALL_DIR/" 2>/dev/null || true
    cp "$SOURCE_DIR/install.sh" "$INSTALL_DIR/" 2>/dev/null || true
    cp "$SOURCE_DIR/uninstall.sh" "$INSTALL_DIR/" 2>/dev/null || true
fi

cd "$INSTALL_DIR"

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
echo -e "${YELLOW}Building...${NC}"
npm run build

# Make CLI executable
chmod +x dist/cli/index.js

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
echo -e "${GREEN}                 Installation Complete!                     ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "Quick Start:"
echo ""
echo -e "  ${GREEN}orchestrate init${NC}              # Initialize a new project"
echo -e "  ${GREEN}orchestrate plan \"Build X\"${NC}   # Create a project plan"
echo -e "  ${GREEN}orchestrate run${NC}               # Execute requirements"
echo -e "  ${GREEN}orchestrate --help${NC}            # Show all commands"
echo ""
echo "Documentation: See README.md in $INSTALL_DIR"
echo ""

# Check if shell needs to be reloaded
if ! command -v orchestrate &> /dev/null; then
    echo -e "${YELLOW}Note: Restart your terminal or run:${NC}"
    echo "  source ~/.bashrc  # or ~/.zshrc"
    echo ""
fi
