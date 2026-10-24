#
# Remit container images (RFC 035 D1-D4). One multi-stage Dockerfile, one
# shared builder stage, one target per service. Build any target from a bare
# clone with zero credentials:
#
#   npm run docker:build -- backend
#
# (`docker build --target backend -t remit/backend .` works the same way for
# apisix/web; the other targets share an
# ARG-parameterized install stage and need
# `--build-arg SERVICE_NAME=backend` added when invoked directly instead of
# through the npm script or docker-bake.hcl, both of which set it.)
#
# Roster (RFC 035 D1): apisix, backend, imap-worker, smtp-worker,
# account-worker, web.
#
# `npm run docker:build -- <target>` wraps this for local use; CI
# (.github/workflows/images.yml) builds every target on push to main.

# Which dictionaries this image carries, declared up here because it also
# decides whether the engine is compiled at all. The empty list is the
# documented opt-out, and the two ARGs below turn it into a stage name:
# non-empty picks `hunspell-wasm-built`, empty picks `hunspell-wasm-none`, and
# BuildKit only builds the one that is selected — so opting out never pulls the
# Emscripten toolchain.
ARG REMIT_SPELLCHECK_LANGUAGES=en,en-GB,nl
ARG SPELLCHECK_ENGINE=${REMIT_SPELLCHECK_LANGUAGES:+built}
ARG SPELLCHECK_ENGINE=${SPELLCHECK_ENGINE:-none}

########################################################################
# manifests — the repo's package.json/package-lock.json files and the
# patch set, with the rest of the source pruned away, so the builder's npm ci
# layer only busts when an install input actually changes, not on every source
# edit.
#
# `patches/` is an install input, not source: npm ci's postinstall runs
# patch-package, and the emitter patches it applies decide what the TypeSpec
# codegen emits. Pruning them here left the builder installing unpatched
# emitters, so every published image carried enum values with their escapes
# eaten — `MessageSystemFlag.Flagged` was `Flagged` rather than `\Flagged`,
# and nothing on the IMAP flag path matched the wire (#79).
#
# This is the portable stand-in for a `COPY --parents <manifest globs>`
# (dockerfile:1-labs): plain multi-stage syntax the CI fleet's podman/buildah
# also accept. `COPY --from` keys its layer cache on the copied content's
# checksum, so the npm ci layer still only busts when an install input
# changes — the same cache property, without the labs frontend.
########################################################################
FROM docker.io/library/node:24 AS manifests
WORKDIR /src
COPY . .
RUN find . -type f ! -name package.json ! -name package-lock.json \
	! -path './patches/*' -delete \
	&& find . -type d -empty -delete

########################################################################
# hunspell-wasm — the composer's spellchecking engine, compiled here.
#
# Hunspell has 141 contributors; every published WebAssembly wrapper of it has
# one, and none clears this repo's dependency bar. So the engine is built from
# an upstream release tarball whose sha256 is pinned in
# docker/hunspell/pin.env, with the Emscripten image as the toolchain
# pin. Nothing is patched: this is a build, not a fork.
#
# The output is two files and the licence texts, ~630 KB before brotli, copied
# into the builder below and staged into the web client's dist/.
#
# `hunspell-wasm-none` is what an empty REMIT_SPELLCHECK_LANGUAGES selects: an
# empty /out on an image the build already pulls, so the builder's COPY below
# stays unconditional while the 3.4 GB toolchain is never fetched. The web
# client stages nothing from build/hunspell when the language list is empty.
########################################################################
FROM docker.io/library/node:24 AS hunspell-wasm-none
RUN mkdir -p /out

FROM docker.io/emscripten/emsdk:6.0.6 AS hunspell-wasm-built
WORKDIR /src
COPY docker/hunspell/ ./docker/hunspell/
ENV OUT_DIR=/out
RUN sh docker/hunspell/build.sh

FROM hunspell-wasm-${SPELLCHECK_ENGINE} AS hunspell-wasm

########################################################################
# builder — npm ci, TypeSpec codegen (make), the web client, the generated
# apisix route table, and one esbuild bundle per node-service entrypoint.
# Shared by every target below so the expensive steps run once.
########################################################################
FROM docker.io/library/node:24 AS builder
WORKDIR /app

# Manifests only, first — so an npm ci is only re-run when a package.json or
# the lockfile actually changes, not on every source edit.
COPY --from=manifests /src ./

# Nothing here touches a private registry: npm ci resolves public npm only.
RUN npm ci --no-audit --no-fund --loglevel=error

COPY . .

# `make` regenerates build/ from the TypeSpec source in-repo (RFC 035 D2).
RUN make

# The engine the spellcheck plugin stages, from the stage above rather than
# from a compiler in this one.
COPY --from=hunspell-wasm /out/ ./build/hunspell/

# The build commit, threaded in from the publisher (images-publish.sh) because
# `.git` is dockerignored — without it the web client's `resolveGitSha` falls
# back to the literal "dev" and every bug report links a dead `/commit/dev` URL.
# `resolveGitSha` reads GITHUB_SHA. Declared here, immediately before the vite
# build, so a per-commit SHA busts only this layer — never the npm ci or make
# layers above it.
ARG GIT_SHA=""
ENV GITHUB_SHA=${GIT_SHA}

# Compose the web client from the primitives with the better-auth shell only —
# the self-host stack is a distributor and omits the Cognito shell entirely.
# Same-origin relative API base (packages/web-client/src/lib/client.ts defaults
# VITE_API_URL-less builds to "/api"); Caddy proxies /api and /content to
# apisix/backend, so no build-time API host is needed.
# The list is what NOTICE.txt and the staged licence files describe, so it is
# fixed here rather than at run time; an empty list builds a web client with no
# spellchecker at all. Adding a tag also needs its row in
# packages/web-client/spellcheck/languages.ts. The default lives on the global
# ARG at the top of this file, which also decides whether the engine is built.
ARG REMIT_SPELLCHECK_LANGUAGES
ENV REMIT_SPELLCHECK_LANGUAGES=${REMIT_SPELLCHECK_LANGUAGES}

RUN npm run build:dist -w packages/web-client -- --auth better-auth

# Only the brotli form of the engine and the dictionaries lands in the image;
# the server sends it with Content-Encoding: br, so what the browser receives
# is the upstream source byte for byte.
RUN node npm-scripts/compress-spellcheck.mjs packages/web-client/dist/spellcheck

# Bakes the generated route table into the apisix image. backend:8080 is the
# in-network service name/port every runtime target below also uses.
RUN APISIX_BACKEND_HOST=backend APISIX_BACKEND_PORT=8080 \
	node --import tsx packages/apisix/generate-config.ts

# One esbuild bundle per service entrypoint — see npm-scripts/docker-bundle.mjs
# for the recipe (ESM, minified, CJS-require banner) and the external/native
# dependency notes.
RUN node npm-scripts/docker-bundle.mjs

# Stage the migration set into its own directory so the backend image COPYs one
# stable path. Directory names are preserved, so the backend image's
# ./migrations-sqlite is byte-identical to a direct COPY.
RUN mkdir -p dist-docker/backend-migrations \
	&& cp -a deploy/vps/migrations-sqlite dist-docker/backend-migrations/migrations-sqlite

########################################################################
# node-service-base — shared runtime layer for the six alpine-based images.
#
# Plain `alpine`, not `node:24-alpine`: the official node:*-alpine images
# still bundle Node's own embedded ICU data (~50MB of locale tables).
# Alpine's own `nodejs` package instead links against system ICU
# (`icu-libs`), the same data every other package on the box already
# shares — verified that's still enough for real use, not a stripped-down
# stub: `Intl.DateTimeFormat`/`Intl.NumberFormat` format correctly and
# `Intl.supportedValuesOf("timeZone")` returns all 417 IANA zones with
# nothing beyond the base `nodejs` package installed (no `icu-data-full`).
# The Node version comes from this Alpine release's package repo, not a
# `node:24` tag — pin the Alpine tag, not a Node one; alpine:3.23 carries
# nodejs 24.17.x as of this writing.
#
# USER switches to the non-root "node" user (uid/gid 1000, created below —
# plain alpine has no such user by default, unlike node:*-alpine) before any
# per-target step, so npm install/COPY --chown never need a trailing
# `chown -R /app` — that pattern doubles image size, because changing
# ownership of an already-large tree (node_modules) copies
# every file into a new union-fs layer instead of mutating in place.
########################################################################
FROM docker.io/library/alpine:3.23 AS node-service-base
RUN apk add --no-cache nodejs \
	&& addgroup -g 1000 node \
	&& adduser -D -u 1000 -G node node
WORKDIR /app
RUN chown node:node /app
USER node
ENV NODE_ENV=production
ENV PORT=8080

########################################################################
# node-service-installed — shared dependency-install stage for the plain
# node-service images (backend, imap-worker, smtp-worker, account-worker,
# queue-sidecar, doctor). Each only differs by which
# docker/runtime/<service>/package.json it installs; SERVICE_NAME picks it.
# `docker-bake.hcl` sets SERVICE_NAME per target, and `npm run docker:build`
# (npm-scripts/docker-build.sh) passes it for direct
# `docker build --target <name>` use too — building one of these
# targets straight from `docker build` (bypassing both) needs
# `--build-arg SERVICE_NAME=<name>` added manually.
########################################################################
FROM node-service-base AS node-service-installed
ARG SERVICE_NAME
COPY --chown=node:node docker/runtime/${SERVICE_NAME}/package.json docker/runtime/${SERVICE_NAME}/package-lock.json ./
USER root
RUN apk add --no-cache npm
USER node
# npm ci (not install): the committed docker/runtime/<service>/package-lock.json
# pins every transitive dependency too, not just the direct ones already
# pinned in package.json — otherwise a floating transitive version could
# drift the image between two builds of the exact same commit.
RUN npm ci --omit=dev --no-audit --no-fund --loglevel=error \
	&& npm cache clean --force
USER root
RUN apk del npm
USER node

########################################################################
# backend
########################################################################
FROM node-service-installed AS backend
COPY --from=builder --chown=node:node /app/dist-docker/backend/server.mjs ./server.mjs
# Same convention the Lambda path already uses (infra's NodeJSArmFunction
# `extraFiles`): packages/backend/src/index.ts looks for
# openapi.json next to the entrypoint before falling back to the repo's
# build/ tree, which does not exist in this image.
COPY --from=builder --chown=node:node /app/build/remit-openapi3/openapi.json ./openapi.json
# migrate.mjs is an alternate entrypoint baked into this same image — "the
# backend image with a migrate command" (RFC 035 D8) — not a ninth image.
# The deploy/vps/docker-compose.yml `migrate` one-shot service overrides CMD
# to run it instead of server.mjs.
COPY --from=builder --chown=node:node /app/dist-docker/backend/migrate.mjs ./migrate.mjs
# Same shape, for the one-time ListId backfill (issue #263): a manually-run
# alternate entrypoint, never wired into a compose one-shot — see
# packages/backend/scripts/backfill-list-id.ts.
COPY --from=builder --chown=node:node /app/dist-docker/backend/backfill-list-id.mjs ./backfill-list-id.mjs
# Same shape again, for the one-time classification backfill over the
# stored-body cohort the classifier never examined (issue #1197): manually-run,
# never a compose one-shot — see packages/backend/scripts/backfill-classification.ts.
COPY --from=builder --chown=node:node /app/dist-docker/backend/backfill-classification.mjs ./backfill-classification.mjs
# Same shape again, for `remit config save` (issue #1021): the operator exports
# their configuration before a migration drops the database, with no browser and
# no session — see packages/backend/scripts/config-save.ts.
COPY --from=builder --chown=node:node /app/dist-docker/backend/config-save.mjs ./config-save.mjs
# Same shape again, for the one-time split of the single database file into the
# app, mail and search databases (#1420) — see packages/migrate/src/split-sqlite.ts.
COPY --from=builder --chown=node:node /app/dist-docker/backend/split-sqlite.mjs ./split-sqlite.mjs
# The migration set, staged in the builder into one directory so this COPY has a
# single stable source. The migrate entrypoint applies ./migrations-sqlite.
COPY --from=builder --chown=node:node /app/dist-docker/backend-migrations/ ./
ENV SERVER_PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]

########################################################################
# imap-worker (poller entrypoint — see packages/imap-worker/src/poller.ts)
########################################################################
FROM node-service-installed AS imap-worker
COPY --from=builder --chown=node:node /app/dist-docker/imap-worker/server.mjs ./server.mjs
# The periodic mailbox-sync tick, an alternate entrypoint in this same image —
# the same shape as the backend's migrate.mjs. The compose `scheduler` service
# overrides CMD to run it; it polls no queue, so it beats under a scheduler.*
# prefix rather than the imap-worker.* files the check below reads, and that
# service replaces the check with one over its own.
COPY --from=builder --chown=node:node /app/dist-docker/imap-worker/scheduler.mjs ./scheduler.mjs
# Liveness is a heartbeat file per poll loop, checked for the age of the oldest
# (D1 of docs/design/standalone-observability.md): a wedged loop stops rewriting
# its own file while the process stays alive, which is the failure `restart:
# unless-stopped` cannot see. No listener and no port. Declared here so a
# non-compose run of this image keeps the check; deploy/vps/docker-compose.sqlite.yml
# repeats it verbatim and the two must stay identical.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=60s \
	CMD ["node", "-e", "const fs=require('node:fs'),d='/data/heartbeat',p='imap-worker.',f=fs.readdirSync(d).filter(n=>n.startsWith(p));process.exit(f.length&&f.every(n=>Date.now()-fs.statSync(d+'/'+n).mtimeMs<420000)?0:1)"]
CMD ["node", "server.mjs"]

########################################################################
# smtp-worker
########################################################################
FROM node-service-installed AS smtp-worker
COPY --from=builder --chown=node:node /app/dist-docker/smtp-worker/server.mjs ./server.mjs
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=60s \
	CMD ["node", "-e", "const fs=require('node:fs'),d='/data/heartbeat',p='smtp-worker.',f=fs.readdirSync(d).filter(n=>n.startsWith(p));process.exit(f.length&&f.every(n=>Date.now()-fs.statSync(d+'/'+n).mtimeMs<420000)?0:1)"]
CMD ["node", "server.mjs"]

########################################################################
# account-worker
########################################################################
FROM node-service-installed AS account-worker
COPY --from=builder --chown=node:node /app/dist-docker/account-worker/server.mjs ./server.mjs
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=60s \
	CMD ["node", "-e", "const fs=require('node:fs'),d='/data/heartbeat',p='account-worker.',f=fs.readdirSync(d).filter(n=>n.startsWith(p));process.exit(f.length&&f.every(n=>Date.now()-fs.statSync(d+'/'+n).mtimeMs<420000)?0:1)"]
CMD ["node", "server.mjs"]

########################################################################
# queue-sidecar — SQLite-backed SQS wire-protocol backend for the self-host
# deployment (ADR: self-host queue backend). Same alpine + system-nodejs base
# as the workers, with better-sqlite3 installed via node-service-installed
# (docker/runtime/queue-sidecar/package.json); no pg. Speaks the AWS Query
# subset the SDK emits on 9324 and persists to its own SQLite file, which the
# compose stack mounts on a dedicated volume. The queue set is supplied at
# runtime through QUEUE_SIDECAR_QUEUES_CONFIG (compose mounts queues.json), the
# same way elasticmq.conf was mounted.
########################################################################
FROM node-service-installed AS queue-sidecar
COPY --from=builder --chown=node:node /app/dist-docker/queue-sidecar/server.mjs ./server.mjs
COPY --from=builder --chown=node:node /app/dist-docker/queue-sidecar/redrive.mjs ./redrive.mjs
ENV QUEUE_SIDECAR_PORT=9324
ENV QUEUE_SIDECAR_DB=/data/queue/queue.db
EXPOSE 9324
HEALTHCHECK --interval=5s --timeout=5s --retries=10 \
	CMD ["node", "-e", "require('http').get('http://127.0.0.1:9324/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
CMD ["node", "server.mjs"]

########################################################################
# doctor — the checker (D7 to D12 of docs/design/standalone-observability.md).
#
# Runs the same check on an interval that `remit doctor` runs on demand, and
# posts a settled change of verdict to a webhook. Its own container because an
# alerter inside the backend dies with the thing it is meant to report.
#
# NO DOCKER SOCKET, and no way to need one: worker liveness is a file on the
# heartbeat volume precisely so that reading it does not require the daemon. A
# second socket-mounting container on a mail server, added for an alert, is a
# cost this design does not pay.
#
# Two entrypoints in one image, the same shape as the backend's migrate.mjs:
# server.mjs is the loop, check.mjs is the exec seam `remit doctor` drives. The
# verdict is one implementation read three ways — at a shell, as an exit code,
# and as an alert.
#
# No EXPOSE and no HEALTHCHECK. It listens on nothing, and nothing watches it
# from inside the box: its liveness rests entirely on the dead-man's switch,
# which is why that switch is not optional.
########################################################################
FROM node-service-installed AS doctor
COPY --from=builder --chown=node:node /app/dist-docker/doctor/server.mjs ./server.mjs
COPY --from=builder --chown=node:node /app/dist-docker/doctor/check.mjs ./check.mjs
CMD ["node", "server.mjs"]

########################################################################
# apisix — stock image, generated route table baked in (RFC 035 D5 parity).
########################################################################
FROM docker.io/apache/apisix:3.13.0-debian AS apisix
COPY --from=builder /app/packages/apisix/config.yaml /usr/local/apisix/conf/config.yaml
COPY --from=builder /app/packages/apisix/apisix.yaml /usr/local/apisix/conf/apisix.yaml
# The upstream image's docker-entrypoint.sh only trusts config.yaml's
# etcd-less (data_plane/yaml) setup when this is set — without it, the
# entrypoint ignores config.yaml's config_provider and always runs
# `apisix init_etcd`, which retries against a nonexistent etcd and then
# exits (crash-looping in compose, where the restart is fast enough for the
# retries to actually run out).
ENV APISIX_STAND_ALONE=true

########################################################################
# web — static server for the vite dist/, no framework dependency.
########################################################################
FROM docker.io/library/alpine:3.23 AS web
RUN apk add --no-cache nodejs \
	&& addgroup -g 1000 node \
	&& adduser -D -u 1000 -G node node
WORKDIR /app
RUN chown node:node /app
USER node
COPY --from=builder --chown=node:node /app/packages/web-client/dist ./dist
COPY --chown=node:node docker/runtime/web/server.mjs ./server.mjs
ENV PORT=8080
ENV WEB_DIST_DIR=/app/dist
EXPOSE 8080
CMD ["node", "server.mjs"]

########################################################################
# updater — the remit wrapper in a container (RFC 037 D4, #133).
#
# The app triggers a self-update by writing request.json onto a private volume;
# this container watches for it and runs the same deploy/vps/remit the host
# operator runs — one implementation of the atomic update, gate and rollback,
# never a second. It binds no port: the volume mount is the whole authentication
# story, reachable only by the two services that mount it (RFC 037 D4).
#
# Minimal on purpose, and independent of the builder stage above. It carries the
# wrapper, a container CLI with the compose plugin, and sqlite3 + su-exec baked
# in — so the pre-update snapshot never waits on an apk install at the moment it
# is most needed, which may be a recovery from the very network that install
# would use. flock backs the wrapper's run lock.
#
# The wrapper drives the stack over the mounted docker socket and spawns its
# snapshot/restore/health helpers as containers off this same image (its
# entrypoint points REMIT_UPDATE_HELPER_IMAGE at itself), so /snapshot-db.sh is
# baked in rather than bind-mounted: a container path would not resolve against
# the host daemon those helpers talk to.
########################################################################
FROM docker.io/library/alpine:3.23 AS updater
RUN apk add --no-cache docker-cli docker-cli-compose sqlite su-exec flock
# The same wrapper file the host installs, and the same VACUUM INTO primitive
# the backup sidecar and the host wrapper already share.
COPY deploy/vps/remit /usr/local/bin/remit
COPY deploy/vps/backup/snapshot-db.sh /snapshot-db.sh
COPY docker/runtime/updater/entrypoint.sh /usr/local/bin/updater-entrypoint
RUN chmod +x /usr/local/bin/remit /usr/local/bin/updater-entrypoint
# The deployment directory, the run's private state volume and the control seam,
# as the compose service mounts them. STATE_MOUNT is the volume *name* the host
# daemon knows, because the helper containers bind it by that name. SNAPSHOT_LIB
# is cleared so the wrapper sources the baked /snapshot-db.sh and attempts no
# bind mount.
#
# REMIT_DIR is the last-resort default for a bare `docker run`; the compose
# service overrides it with the deployment directory's absolute *host* path
# (${REMIT_DEPLOY_DIR}), which is what makes socket-driven bind resolution
# identical inside the container and on the host (reader#272). The entrypoint
# proves that identity before serving.
ENV REMIT_DIR=/deployment
ENV REMIT_UPDATE_STATE_DIR=/data/updater
ENV REMIT_UPDATE_STATE_MOUNT=remit_updater_state
ENV REMIT_UPDATE_CONTROL_DIR=/data/control
ENV REMIT_UPDATE_SNAPSHOT_LIB=""
ENV REMIT_UPDATER_IMAGE_REPO=ghcr.io/remit-mail/reader/updater
ENTRYPOINT ["/usr/local/bin/updater-entrypoint"]
