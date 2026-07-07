# APISIX edge auth tier (Postgres-parity)

APISIX runs in **standalone, etcd-less** mode as the edge that verifies
better-auth RS256 JWTs before any request reaches the backend. The same gateway
is intended to run in production (Scaleway serverless container) for dev-prod
parity — this is the local incarnation.

## How it works

- `config.yaml` — APISIX in `data_plane` role with the `yaml` config provider
  (no control plane, no etcd).
- `apisix.yaml` — **generated** by `generate-config.ts` from
  `build/remit-openapi3/openapi.json`. One route per OpenAPI path, each guarded
  by the `openid-connect` plugin in `bearer_only` mode. `/api/auth/*` (token
  minting + JWKS) and `/health` stay public.
- The `openid-connect` plugin discovers the JWKS via an OIDC discovery document
  and follows key rotation automatically (the capability Kong gates behind
  Enterprise). better-auth does not serve a discovery document, so the dev-server
  serves a synthetic one at `/api/auth/.well-known/openid-configuration` pointing
  at better-auth's real JWKS.

## Run it

```bash
# 1. Backend must be reachable from the container. Run it with a base URL the
#    container can resolve (host.docker.internal) so the token issuer, the
#    discovery doc, and the JWKS all agree:
DATA_BACKEND=postgres SERVER_PORT=5436 \
  PG_CONNECTION_URL=postgresql://remit:remit@localhost:5432/remit_test \
  BETTER_AUTH_URL=http://host.docker.internal:5436 \
  BETTER_AUTH_SECRET=e2e-better-auth-secret-at-least-32-chars-long \
  npm run run:backend:pg   # (or set the same env on start:backend:pg)

# 2. Start the edge (regenerates routes, pulls apache/apisix, runs on :9080)
npm run apisix:start

# 3. Stop it
npm run apisix:stop
```

## Verified behaviour

Confirmed locally against the pg backend:

| Request through `:9080`            | Result |
| ---------------------------------- | ------ |
| `POST /api/auth/sign-up/email`     | 200 (public) |
| `GET /api/auth/token`              | mints an RS256 JWT (public) |
| `GET /me` no token                 | **401 at the edge** |
| `GET /me` valid better-auth JWT    | proxied through (404 — authenticated, no account) |
| `GET /me` malformed token          | **401 at the edge** |

## Notes

- The backend still verifies the JWT itself (defence in depth); if it sees
  pre-injected authorizer claims it trusts them, otherwise it re-verifies. So the
  edge is additive, not a single point of trust.
- `--add-host=host.docker.internal:host-gateway` is set so the container reaches
  the host backend. On Scaleway this becomes the real service address.
- `client_secret` is a placeholder — `bearer_only` never runs the auth-code flow,
  it only validates presented tokens against the JWKS.
