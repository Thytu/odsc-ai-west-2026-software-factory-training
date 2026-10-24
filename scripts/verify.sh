#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

case "${1:---full}" in
  --pre-commit)
    pnpm run check:data-boundary
    ;;
  --full)
    pnpm run check:data-boundary
    pnpm run check
    pnpm run smoke:reminder
    pnpm run build
    ;;
  *)
    echo "Usage: scripts/verify.sh [--pre-commit|--full]" >&2
    exit 2
    ;;
esac
