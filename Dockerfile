#
# Remit container images (RFC 035 D1-D4). One multi-stage Dockerfile, one
# shared builder stage, one target per service. Build any target from a bare
# clone with zero credentials:
#
#   npm run docker:build -- backend
#
# (`docker build --target backend -t remit/backend .` works the same way for
# apisix/web/search-index-worker; the other five targets share an
# ARG-parameterized install stage and need
# `--build-arg SERVICE_NAME=backend` added when invoked directly instead of
# through the npm script or docker-bake.hcl, both of which set it.)
#
# Roster (RFC 035 D1): apisix, backend, imap-worker, smtp-worker,
# account-worker, pg-index-worker, search-index-worker, web.
#
# `npm run docker:build -- <target>` wraps this for local use; CI
# (.github/workflows/images.yml) builds every target on push to main.

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
RUN npm run build:dist -w packages/web-client -- --auth better-auth

# Bakes the generated route table into the apisix image. backend:8080 is the
# in-network service name/port every runtime target below also uses.
RUN APISIX_BACKEND_HOST=backend APISIX_BACKEND_PORT=8080 \
	node --import tsx apisix/generate-config.ts

# One esbuild bundle per service entrypoint — see npm-scripts/docker-bundle.mjs
# for the recipe (ESM, minified, CJS-require banner) and the external/native
# dependency notes.
RUN node npm-scripts/docker-bundle.mjs

# Stage whichever migration sets ship in this tree into one directory so the
# backend image COPYs it unconditionally — a Dockerfile COPY cannot skip a
# missing path. Both sets ship here (Postgres `migrations` + `migrations-sqlite`,
# RFC 036 D5); the open-core export strips the Postgres set, and this loop
# tolerates its absence. Directory names are preserved, so the backend image's
# ./migrations and ./migrations-sqlite are byte-identical to a direct COPY.
RUN mkdir -p dist-docker/backend-migrations \
	&& for set in migrations migrations-sqlite; do \
		if [ -d "deploy/vps/$set" ]; then \
			cp -a "deploy/vps/$set" "dist-docker/backend-migrations/$set"; \
		fi; \
	done

########################################################################
# sqlite-vec-musl — compile the vec0 loadable extension against musl.
#
# The vector store's KNN read path — the Organize "find similar" widen
# (packages/backend/src/service/organize.ts matchSemantic, pooling an anchor's
# already-stored chunk vectors, no embedding model involved) — loads sqlite-vec
# through better-sqlite3's loadExtension. The npm `sqlite-vec` package ships a
# glibc-only prebuilt `vec0.so` (linked ld-linux / GLIBC_2.2.5) that cannot
# dlopen on the Alpine/musl backend image, so the extension never loaded there
# and semantic-capability.ts gated the widen off permanently. sqlite-vec is a
# single-file C amalgamation; compile it against musl here and copy only the
# ~140KB stripped `vec0.so` into the backend image — no model, no npm package,
# no base-image switch.
#
# Pinned to the same version the search-index-worker image installs from npm
# (docker/runtime/search-index-worker/package.json: sqlite-vec 0.1.9). The
# GitHub release tarball is checksum-verified, so a moved or tampered asset
# fails the build loudly instead of baking an unknown binary.
#
# `-D__COSMOPOLITAN__` disables one platform-guarded typedef block
# (`typedef u_int8_t uint8_t;`) that assumes a glibc/BSD `u_int8_t` musl does not
# provide; stdint.h already defines those types, so the block is redundant here.
# That macro is referenced nowhere else in the amalgamation, so defining it is a
# surgical off-switch for that block, not a claim about the target platform.
# SIMD (AVX/NEON) stays off — it is opt-in via SQLITE_VEC_ENABLE_*, and the
# portable scalar path needs no runtime CPU-feature guarantee. The basename
# stays `vec0` so SQLite derives the `sqlite3_vec_init` entry point from the
# filename (it copies only alphabetic characters, dropping the `0`).
########################################################################
FROM docker.io/library/alpine:3.23 AS sqlite-vec-musl
ARG SQLITE_VEC_VERSION=0.1.9
ARG SQLITE_VEC_SHA256=3acd67cb4aff080c7050926fd3cf8227905fe5b7ee3829d8ee5024ab1283cf61
RUN apk add --no-cache build-base sqlite-dev sqlite curl
WORKDIR /build
RUN curl -fsSL -o amalgamation.tar.gz \
		"https://github.com/asg017/sqlite-vec/releases/download/v${SQLITE_VEC_VERSION}/sqlite-vec-${SQLITE_VEC_VERSION}-amalgamation.tar.gz" \
	&& echo "${SQLITE_VEC_SHA256}  amalgamation.tar.gz" | sha256sum -c - \
	&& tar xzf amalgamation.tar.gz \
	&& gcc -O2 -fPIC -shared -D__COSMOPOLITAN__ sqlite-vec.c -o vec0.so -lm \
	&& strip vec0.so \
	# Prove the stripped .so dlopens on musl and the `vec0` basename resolves the
	# `sqlite3_vec_init` entry point, by creating the exact vec0 virtual table the
	# store uses — offline (no network needed for the load). A musl ABI break, a
	# renamed entry point, or a missing symbol fails the build here instead of
	# shipping a backend image whose anchor widen 500s on first query.
	&& sqlite3 :memory: ".load /build/vec0" \
		"CREATE VIRTUAL TABLE t USING vec0(id TEXT PRIMARY KEY, embedding FLOAT[4] distance_metric=cosine)" \
		"SELECT vec_version()"

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
# ownership of an already-large tree (node_modules, a baked model) copies
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
# node-service-installed — shared dependency-install stage for the five
# plain node-service images (backend, imap-worker, smtp-worker,
# account-worker, pg-index-worker). Each only differs by which
# docker/runtime/<service>/package.json it installs; SERVICE_NAME picks it.
# `docker-bake.hcl` sets SERVICE_NAME per target, and `npm run docker:build`
# (npm-scripts/docker-build.sh) passes it for direct
# `docker build --target <name>` use too — building one of these five
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
# Both migration sets, staged in the builder into one directory so this COPY is
# unconditional. The migrate entrypoint applies ./migrations (Postgres) or
# ./migrations-sqlite by DATA_BACKEND (RFC 036 D5); the compose `migrate` service
# picks one. The open-core export ships only the sqlite set — the builder stage
# tolerates the Postgres set's absence, which a bare COPY cannot.
COPY --from=builder --chown=node:node /app/dist-docker/backend-migrations/ ./
# The musl-compiled sqlite-vec loadable extension (see the sqlite-vec-musl stage).
# SQLITE_VEC_EXTENSION_PATH short-circuits the npm package's glibc-only
# getLoadablePath() in the vector store's loader
# (packages/search-service/src/backends/sqlite-vec.ts), so the Organize anchor
# widen's KNN reads over vec.db work on this Alpine image. Free-text
# /search/semantic stays gated — it needs the query embedder this image omits.
COPY --from=sqlite-vec-musl --chown=node:node /build/vec0.so ./vec0.so
ENV SQLITE_VEC_EXTENSION_PATH=/app/vec0.so
ENV SERVER_PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]

########################################################################
# imap-worker (poller entrypoint — see packages/imap-worker/src/poller.ts)
########################################################################
FROM node-service-installed AS imap-worker
COPY --from=builder --chown=node:node /app/dist-docker/imap-worker/server.mjs ./server.mjs
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
# pg-index-worker — Postgres LISTEN/NOTIFY -> SQS relay (no embedding model;
# see npm-scripts/docker-bundle.mjs for why this differs from the RFC text).
########################################################################
FROM node-service-installed AS pg-index-worker
COPY --from=builder --chown=node:node /app/dist-docker/pg-index-worker/server.mjs ./server.mjs
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
ENV QUEUE_SIDECAR_PORT=9324
ENV QUEUE_SIDECAR_DB=/data/queue/queue.db
EXPOSE 9324
HEALTHCHECK --interval=5s --timeout=5s --retries=10 \
	CMD ["node", "-e", "require('http').get('http://127.0.0.1:9324/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
CMD ["node", "server.mjs"]

########################################################################
# search-index-worker — bakes the local embedding model at build time.
#
# Exception to the alpine/musl base every other node-service image uses:
# onnxruntime-node ships prebuilt binaries linked against glibc
# (ld-linux-x86-64.so.2), which does not exist on musl. Verified by actually
# trying alpine here first — the model bake step below fails with
# ERR_DLOPEN_FAILED ("Error loading shared library ld-linux-x86-64.so.2: No
# such file or directory") before it can even load the runtime. Rebuilding
# onnxruntime-node from source for musl is out of proportion to this PR;
# node:24-slim (glibc/Debian) stays for this one image only.
########################################################################
FROM docker.io/library/node:24-slim AS search-index-worker
WORKDIR /app
RUN chown node:node /app
USER node
ENV NODE_ENV=production
COPY --chown=node:node docker/runtime/search-index-worker/package.json docker/runtime/search-index-worker/package-lock.json ./
# npm ci: see node-service-installed's comment above — the committed
# package-lock.json pins @huggingface/transformers' full transitive graph
# (onnxruntime-node, sharp, ...), not just the top-level version.
RUN npm ci --omit=dev --no-audit --no-fund --loglevel=error \
	&& npm cache clean --force \
	&& \
	# onnxruntime-node ships prebuilt binaries for every platform plus a CUDA
	# execution provider (~315MB alone) in one npm package; this image is
	# linux/amd64, CPU-only (no GPU on the 2vCPU/4GB reference VPS), so prune
	# everything but the linux/x64 CPU provider. onnxruntime-web (the
	# browser/wasm build @huggingface/transformers also depends on) is never
	# loaded from Node.js and is dropped entirely. Together this cuts a
	# multi-hundred-MB dependency down to what the CPU embedding path uses.
	#
	# Every path below is asserted to exist right before removal and asserted
	# gone right after: if a dependency bump moves these files, the build
	# fails loudly instead of silently shipping the ~315MB CUDA provider in a
	# "successful" image.
	ORT_NODE_DIR=node_modules/onnxruntime-node/bin/napi-v6 && \
	ORT_CUDA="$ORT_NODE_DIR/linux/x64/libonnxruntime_providers_cuda.so" && \
	ORT_TENSORRT="$ORT_NODE_DIR/linux/x64/libonnxruntime_providers_tensorrt.so" && \
	test -e "$ORT_CUDA" || { echo "FATAL: $ORT_CUDA missing before prune — onnxruntime-node layout changed, update the Dockerfile prune paths" >&2; exit 1; } && \
	test -d node_modules/onnxruntime-web || { echo "FATAL: node_modules/onnxruntime-web missing before prune — dependency layout changed, update the Dockerfile prune paths" >&2; exit 1; } && \
	rm -rf "$ORT_NODE_DIR/darwin" "$ORT_NODE_DIR/win32" "$ORT_NODE_DIR/linux/arm64" \
		"$ORT_CUDA" "$ORT_TENSORRT" \
		node_modules/onnxruntime-web && \
	test ! -e "$ORT_CUDA" || { echo "FATAL: $ORT_CUDA still present after prune" >&2; exit 1; }
USER root
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
	/usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
USER node
COPY --chown=node:node docker/runtime/search-index-worker/bake-model.mjs ./bake-model.mjs
# Bake the int8-quantized model_quantized.onnx (~118MB), not the fp32
# model.onnx (~470MB): SEARCH_EMBEDDING_DTYPE=q8 here and in the runtime ENV
# below make the bake and the worker resolve the identical cached file. Search
# scoring differs slightly from the fp32 deployment targets by design —
# embeddings are a rebuildable projection re-derived on reindex, so cross-target
# parity is not required (see deploy/vps/README.md).
RUN MODEL_ID=Xenova/paraphrase-multilingual-MiniLM-L12-v2 && \
	SEARCH_EMBEDDING_MODEL_ID="$MODEL_ID" SEARCH_EMBEDDING_DTYPE=q8 \
		node bake-model.mjs && \
	rm bake-model.mjs && \
	# Assert the bake fetched the quantized weights and NOT the fp32 file: if a
	# transformers.js bump changes the dtype→filename mapping or the default
	# precision, fail the build loudly instead of silently shipping the ~470MB
	# fp32 model (or an image with no model at all).
	MODEL_CACHE="node_modules/@huggingface/transformers/.cache/$MODEL_ID/onnx" && \
	test -f "$MODEL_CACHE/model_quantized.onnx" || { echo "FATAL: $MODEL_CACHE/model_quantized.onnx missing after bake — dtype=q8 did not resolve model_quantized.onnx, transformers.js dtype mapping changed" >&2; exit 1; } && \
	test ! -f "$MODEL_CACHE/model.onnx" || { echo "FATAL: $MODEL_CACHE/model.onnx present after bake — fp32 weights baked into the image, dtype=q8 was ignored" >&2; exit 1; }
# sharp is NOT pruned, unlike onnxruntime-web above, despite
# `feature-extraction` (text embeddings) never calling into it at runtime:
# @huggingface/transformers' Node entrypoint (transformers.node.mjs) has a
# static top-level `import sharp from "sharp"`, so it's a hard module-load
# dependency, not a lazily-invoked one. Verified by actually removing
# node_modules/sharp and node_modules/@img here and re-running the exact
# `pipeline("feature-extraction", ...)` call server.mjs makes — it throws
# `ERR_MODULE_NOT_FOUND: Cannot find package 'sharp'` before any embedding
# code runs, crash-looping the container. Keeping it is the correct,
# verified call, not an oversight.
COPY --from=builder --chown=node:node /app/dist-docker/search-index-worker/server.mjs ./server.mjs
ENV SEARCH_EMBEDDING_PROVIDER=local
ENV SEARCH_EMBEDDING_MODEL_ID=Xenova/paraphrase-multilingual-MiniLM-L12-v2
ENV SEARCH_EMBEDDING_DTYPE=q8
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=60s \
	CMD ["node", "-e", "const fs=require('node:fs'),d='/data/heartbeat',p='search-index-worker.',f=fs.readdirSync(d).filter(n=>n.startsWith(p));process.exit(f.length&&f.every(n=>Date.now()-fs.statSync(d+'/'+n).mtimeMs<420000)?0:1)"]
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
COPY --from=builder /app/apisix/config.yaml /usr/local/apisix/conf/config.yaml
COPY --from=builder /app/apisix/apisix.yaml /usr/local/apisix/conf/apisix.yaml
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
