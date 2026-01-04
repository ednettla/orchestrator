#!/bin/bash

# Setup Git Hooks Script
# Installs git hooks for automatic version bumping

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
HOOKS_DIR="$PROJECT_DIR/.git/hooks"

echo "Setting up git hooks..."

# Create pre-push hook that bumps version
cat > "$HOOKS_DIR/pre-push" << 'HOOK'
#!/bin/bash

# Pre-push hook: Bump patch version before pushing
# This ensures each push has a unique version

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

# Only bump if pushing to main
while read local_ref local_sha remote_ref remote_sha; do
    if [[ "$remote_ref" == "refs/heads/main" ]]; then
        echo "Bumping version before push to main..."

        # Bump patch version
        "$PROJECT_DIR/scripts/bump-version.sh" patch

        # Add and amend the commit with version bump
        git add "$PROJECT_DIR/package.json"
        git commit --amend --no-edit

        echo "Version bumped and committed."
    fi
done

exit 0
HOOK

chmod +x "$HOOKS_DIR/pre-push"

echo "✓ Git hooks installed"
echo ""
echo "Installed hooks:"
echo "  - pre-push: Automatically bumps patch version when pushing to main"
