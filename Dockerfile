# syntax=docker/dockerfile:1-labs
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
# builder — npm ci, TypeSpec codegen (make), the web client, the generated
# apisix route table, and one esbuild bundle per node-service entrypoint.
# Shared by every target below so the expensive steps run once.
########################################################################
FROM node:24 AS builder
WORKDIR /app

# Manifests only, first — so an npm ci is only re-run when a package.json or
# the lockfile actually changes, not on every source edit.
COPY --parents package.json package-lock.json packages/*/package.json infra/package.json infra-dns/package.json ./

# Nothing here touches a private registry: npm ci resolves public npm only.
RUN npm ci --no-audit --no-fund --loglevel=error

COPY . .

# `make` regenerates build/ from the TypeSpec source in-repo (RFC 035 D2).
RUN make

# Same-origin relative API base (packages/web-client/src/lib/client.ts
# defaults VITE_API_URL-less builds to "/api"); Caddy proxies /api and
# /content to apisix/backend, so no build-time API host is needed.
RUN VITE_BETTER_AUTH_ENABLED=1 npm run build -w packages/web-client

# Bakes the generated route table into the apisix image. backend:8080 is the
# in-network service name/port every runtime target below also uses.
RUN APISIX_BACKEND_HOST=backend APISIX_BACKEND_PORT=8080 \
	node --import tsx apisix/generate-config.ts

# One esbuild bundle per service entrypoint — see npm-scripts/docker-bundle.mjs
# for the recipe (ESM, minified, CJS-require banner) and the external/native
# dependency notes.
RUN node npm-scripts/docker-bundle.mjs

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
FROM alpine:3.23 AS node-service-base
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
COPY --from=builder --chown=node:node /app/deploy/vps/migrations ./migrations
ENV SERVER_PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]

########################################################################
# imap-worker (poller entrypoint — see packages/imap-worker/src/poller.ts)
########################################################################
FROM node-service-installed AS imap-worker
COPY --from=builder --chown=node:node /app/dist-docker/imap-worker/server.mjs ./server.mjs
CMD ["node", "server.mjs"]

########################################################################
# smtp-worker
########################################################################
FROM node-service-installed AS smtp-worker
COPY --from=builder --chown=node:node /app/dist-docker/smtp-worker/server.mjs ./server.mjs
CMD ["node", "server.mjs"]

########################################################################
# account-worker
########################################################################
FROM node-service-installed AS account-worker
COPY --from=builder --chown=node:node /app/dist-docker/account-worker/server.mjs ./server.mjs
CMD ["node", "server.mjs"]

########################################################################
# pg-index-worker — Postgres LISTEN/NOTIFY -> SQS relay (no embedding model;
# see npm-scripts/docker-bundle.mjs for why this differs from the RFC text).
########################################################################
FROM node-service-installed AS pg-index-worker
COPY --from=builder --chown=node:node /app/dist-docker/pg-index-worker/server.mjs ./server.mjs
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
FROM node:24-slim AS search-index-worker
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
RUN SEARCH_EMBEDDING_MODEL_ID=Xenova/paraphrase-multilingual-MiniLM-L12-v2 \
	node bake-model.mjs \
	&& rm bake-model.mjs
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
CMD ["node", "server.mjs"]

########################################################################
# apisix — stock image, generated route table baked in (RFC 035 D5 parity).
########################################################################
FROM apache/apisix:3.13.0-debian AS apisix
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
FROM alpine:3.23 AS web
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
