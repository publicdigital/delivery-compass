#!/bin/sh
set -eu

# A Fly (or any) volume mounts owned by root:root, which masks the ownership set in
# the image. Fix it here, as root, then hand the process to the unprivileged user.
# If there is no volume this is a no-op on a directory that is already correct.
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$(dirname "${FEEDBACK_DB:-/data/feedback.db}")"
  chown -R node:node "$(dirname "${FEEDBACK_DB:-/data/feedback.db}")" 2>/dev/null || true
  exec gosu node "$@"
fi

exec "$@"
