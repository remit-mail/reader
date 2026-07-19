// Default distributor entry: composes the app shell with the combined auth
// provider (Cognito + better-auth, selected at runtime by `config.js`). This is
// what `@remit/web-client-dist` ships — one artifact for every deployment. A
// single-provider deployment writes its own entry against the primitives and
// omits the shell it does not use; see `harness/` for the reference build.
import "./auth/cognito/cognito.css";
import { combinedAuthProvider } from "./auth/combined-provider";
import { mountApp } from "./shell";

mountApp({ authProvider: combinedAuthProvider });
