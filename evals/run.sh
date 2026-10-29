#!/usr/bin/env bash
# Does Claude choose to use the library when someone asks a delivery question?
#
# Puts every question in evals/questions.txt to Claude Code in headless mode, with this
# MCP server as its only tool, and counts the answers that called a library tool.
# Writes the raw transcripts to evals/results/<label>/ and a summary to evals/<label>.md.
#
#   evals/run.sh baseline                       # against a local server: npm run serve
#   evals/run.sh live "https://…/mcp?key=…"     # against any other copy
#
# Point it at a local copy where you can: runs against the live site land in the trial's
# logs. Claude Code is not Claude.ai, so read the numbers as a direction, not as what
# Claude.ai users will see. MODEL (default sonnet), TOOLS (below) and JOBS (default 4)
# can be set.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

if [ "${1:-}" = "--one" ]; then
  # One question, as "NN|kind|question". Run in parallel by the loop below.
  IFS='|' read -r n kind question <<< "$2"
  cd "$WORK" # an empty folder, so no project instructions or memory are read
  # A clean environment, so nothing from a parent Claude session (this one may be run
  # from inside one) changes how the child behaves or authenticates.
  # Up to three tries: a run that starts alongside others sometimes ends with no answer
  # at all, and that is a failed run, not Claude choosing not to use the library.
  for try in 1 2 3; do
    env -i HOME="$HOME" USER="$USER" LOGNAME="${LOGNAME:-$USER}" TMPDIR="${TMPDIR:-/tmp}" PATH="$PATH" TERM=dumb claude -p "$question" --output-format stream-json --verbose --model "$MODEL" \
      --mcp-config "$WORK/mcp.json" --strict-mcp-config --setting-sources "" --tools "$TOOLS" \
      --allowedTools mcp__gov-delivery-library ${TOOLS//,/ } --no-session-persistence \
      > "$OUT/$n.jsonl" 2> "$OUT/$n.err" || true
    grep -q '"type":"result"' "$OUT/$n.jsonl" && break
    echo "  question $n gave no answer (try $try)"
    sleep 5
  done
  printf '%s|%s\n' "$kind" "$question" > "$OUT/$n.q"
  echo "  done $n"
  exit 0
fi

LABEL="${1:?usage: evals/run.sh <label> [mcp url]}"
URL="${2:-http://localhost:3000/mcp?key=gdl-trial-2026}"
export MODEL="${MODEL:-sonnet}"
# Built-in tools Claude also gets, comma-separated. Empty: the library is the only tool,
# which flatters it. TOOLS=WebSearch,WebFetch is closer to Claude.ai with web search on.
export TOOLS="${TOOLS:-}"
export OUT="$DIR/results/$LABEL"
export WORK="$(mktemp -d)"
rm -rf "$OUT" && mkdir -p "$OUT"
printf '{"mcpServers":{"gov-delivery-library":{"type":"http","url":"%s"}}}\n' "$URL" > "$WORK/mcp.json"

echo "Running $(grep -cv -e '^#' -e '^$' "$DIR/questions.txt") questions on ${MODEL}..."
# NUL-separated, so quotes and £ signs pass through xargs untouched. (tr, because macOS
# awk cannot print a NUL.)
grep -v -e '^#' -e '^$' "$DIR/questions.txt" | awk '{ printf "%02d|%s\n", NR, $0 }' | tr '\n' '\0' |
  xargs -0 -n1 -P "${JOBS:-4}" "$0" --one

node "$DIR/summarise.mjs" "$OUT" "$LABEL" "$MODEL" "$TOOLS" > "$DIR/$LABEL.md"
rm -rf "$WORK"
echo "Summary: evals/$LABEL.md"
head -n 8 "$DIR/$LABEL.md" | tail -n +3
