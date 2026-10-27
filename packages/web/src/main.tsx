import { betterAuthProvider } from "@remit/web-client/auth/better-auth";
import { mountApp } from "@remit/web-client/shell";

mountApp({ authProvider: betterAuthProvider });
