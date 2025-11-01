#!/usr/bin/env bash
set -euo pipefail

addr="${CADDY_ADDR:-:8000}"
root="${PWD}"

if ! command -v caddy >/dev/null 2>&1; then
  echo "Error: caddy executable not found in PATH. Try running inside the project dev shell." >&2
  exit 1
fi

pretty_addr="$addr"
if [[ "$addr" == :* ]]; then
  pretty_addr="localhost${addr}"
fi

echo "Serving ${root} at http://${pretty_addr}"
exec caddy file-server --browse --listen "${addr}" --root "${root}" "$@"
