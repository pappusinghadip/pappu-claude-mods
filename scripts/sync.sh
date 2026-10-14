#!/bin/sh
# Copies shared/ui.ts into every plugin that uses it (a plugin can only import its own files).
cd "$(dirname "$0")/.." && for p in plugins/*/hooks; do [ -f "$p/ui.ts" ] && cp shared/ui.ts "$p/ui.ts"; done; true
