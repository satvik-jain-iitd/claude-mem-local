#!/usr/bin/env bash
# Story #146 (epic #130, GoServe feedback #146, validated shape: GoServe story #821, PR #823). Every
# screen in docs/screens.txt (`name | path | viewport | setup step`, # comments and blanks ignored,
# the same opt-in shape as docs/frontend-paths.txt) is rendered and compared by the project's own
# Playwright spec (template: docs/templates/screens.spec.ts, docs/SCREENS.md has the full pattern:
# a STEPS map keyed by the setup-step column, toHaveScreenshot baselines made on CI only, never a
# laptop, maxDiffPixels: 10, animations disabled, self-hosted fonts, document.fonts.ready awaited).
# This script only orchestrates `npx playwright test`, the same way check_frontend_design.sh never
# ships a stylesheet checker.
#   screens.sh            render only: PNGs go to $SCREENS_OUT, nothing is compared
#   screens.sh --check    render and compare with the accepted pictures; non-zero when a screen changed
#   screens.sh --update   replace the accepted pictures (the diff of those PNGs is what the reviewer looks at)
# Configure once per project with env vars (a thin per-project wrapper can also just set these and
# exec this script, as scripts/screens.sh itself becomes once a project adopts it):
#   SCREENS_APP_DIR   directory to run `npx playwright test` from (default: this script's own ../..)
#   SCREENS_SPEC      the spec file, relative to SCREENS_APP_DIR (default: tests/e2e/screens.spec.ts)
#   SCREENS_OUT       where renders are written (default: $SCREENS_APP_DIR/screens-out)
set -u
repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "screens.sh: not a git repo" >&2; exit 2; }
app_dir="${SCREENS_APP_DIR:-$repo_root}"
spec="${SCREENS_SPEC:-tests/e2e/screens.spec.ts}"
screens_file="${SCREENS_FILE:-docs/screens.txt}"

if [ ! -f "$repo_root/$screens_file" ] || ! grep -qvE '^[[:space:]]*(#|$)' "$repo_root/$screens_file"; then
  echo "no screens configured ($screens_file): check skipped"
  exit 0
fi

cd "$app_dir" || { echo "screens.sh: no such directory: $app_dir (set SCREENS_APP_DIR)" >&2; exit 2; }
export SCREENS_OUT="${SCREENS_OUT:-$PWD/screens-out}"
mkdir -p "$SCREENS_OUT"
case "${1:-}" in
  --check)  npx playwright test "$spec" --project=chromium ;;
  --update) npx playwright test "$spec" --project=chromium --update-snapshots ;;
  "")       SCREENS_RENDER_ONLY=1 npx playwright test "$spec" --project=chromium ;;
  *)        echo "usage: screens.sh [--check|--update]" >&2; exit 2 ;;
esac
rc=$?
echo "renders: $SCREENS_OUT"
exit $rc
