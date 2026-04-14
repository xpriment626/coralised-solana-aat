#!/bin/bash
# Coral-launched startup for solana-code-recon
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== solana-code-recon ==="
echo "Agent ID:       $CORAL_AGENT_ID"
echo "Session ID:     $CORAL_SESSION_ID"
echo "Connection URL: $CORAL_CONNECTION_URL"

cd "$ROOT_DIR"
exec npx tsx "$SCRIPT_DIR/index.ts"
