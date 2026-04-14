#!/bin/bash
# Coral-launched startup for solana-phantom-connect
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== solana-phantom-connect ==="
echo "Agent ID:       $CORAL_AGENT_ID"
echo "Session ID:     $CORAL_SESSION_ID"
echo "Connection URL: $CORAL_CONNECTION_URL"

cd "$ROOT_DIR"
exec npx tsx "$SCRIPT_DIR/index.ts"
