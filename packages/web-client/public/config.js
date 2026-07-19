// Runtime deployment configuration, read by src/runtime-config.ts before the
// app boots. This default serves the self-host stack (better-auth identity).
// Each deployment replaces this file: the AWS deploy writes Cognito values, and
// the dev server injects it from REMIT_RUNTIME_CONFIG.
window.__REMIT_CONFIG__ = { betterAuthEnabled: true };
