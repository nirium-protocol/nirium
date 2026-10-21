#!/usr/bin/env bash
# Typecheck one example against an SDK tarball packed from this checkout (#143).
# Usage: typecheck-example.sh <example-dir> <nirium-*.tgz>
# Network: npm install only. Flags mirror sdk-test.yml (--legacy-peer-deps, see its comment).
set -euo pipefail

dir=$1
tgz=$(realpath "$2")
npm_flags=(--no-audit --no-fund --legacy-peer-deps)
cd "$dir"

if [ -f package-lock.json ]; then
  npm ci "${npm_flags[@]}"
else
  npm install --no-save "${npm_flags[@]}"
fi

if node -e 'const p=require("./package.json");process.exit({...p.dependencies,...p.devDependencies}.nirium?0:1)'; then
  # Replaces whatever the lockfile pinned (an npm release or a file: link to an unbuilt SDK).
  npm install --no-save "${npm_flags[@]}" "$tgz"
  # Fail unless nirium resolves to the tarball, not the npm release.
  tar -xOzf "$tgz" package/dist/index.d.ts | cmp - node_modules/nirium/dist/index.d.ts
  echo "nirium resolves to $(basename "$tgz") ($(node -p 'require("nirium/package.json").version'))"
else
  echo "$dir does not depend on nirium; typechecking it as is"
fi

npx --no-install tsc --noEmit -p .
