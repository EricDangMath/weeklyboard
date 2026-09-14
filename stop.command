#!/bin/zsh
set -eu
cd "$(dirname "$0")"
./.local-tools/bin/node scripts/local.mjs stop
