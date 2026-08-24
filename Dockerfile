# syntax=docker/dockerfile:1

# Node 24 for two reasons the app depends on: the built-in node:sqlite module, and
# running TypeScript directly with no build step. Slim, not alpine - node:sqlite is
# compiled into the official image and musl variants are a needless variable here.
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---------------------------------------------------------------------------
# The corpus is baked into the image at build time rather than fetched on boot.
# Three reasons: a cold start must not make the first visitor wait a minute; a new
# machine must not re-hammer GOV.UK; and a fetch that has silently started failing
# should break the *build*, loudly, instead of quietly serving a thin corpus.
FROM node:24-slim AS corpus
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY pipeline ./pipeline
COPY sources ./sources
# Docker would otherwise cache this layer and ship a stale corpus from a previous
# build. Pass --build-arg CORPUS_REFRESH=$(date -u +%FT%H%M) to force a real re-ingest.
ARG CORPUS_REFRESH=unset
RUN echo "corpus refresh token: $CORPUS_REFRESH" \
 && node --experimental-strip-types pipeline/cli.ts ingest \
 && node --experimental-strip-types pipeline/cli.ts watch \
 && node --experimental-strip-types pipeline/cli.ts verify

# ---------------------------------------------------------------------------
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    FEEDBACK_DB=/data/feedback.db

# gosu only, to drop from root to the unprivileged node user after fixing ownership
# of the mounted volume - a fresh volume arrives owned by root, and the app has no
# business running as root. See docker/entrypoint.sh.
RUN apt-get update \
 && apt-get install -y --no-install-recommends gosu \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY pipeline ./pipeline
COPY sources ./sources
COPY web ./web
COPY --from=corpus /app/data/corpus.db ./data/corpus.db
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh && mkdir -p /data && chown -R node:node /app/data /data

EXPOSE 8080
# Reports unhealthy when the corpus is below its floors, not merely when the process
# is alive - the failure this needs to catch is "serving, but with half a corpus".
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "--experimental-strip-types", "web/server.ts"]
