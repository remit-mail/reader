import type { McpPrincipal } from "../server.js";

export type TokenVerification =
	| { ok: true; principal: McpPrincipal }
	| { ok: false; reason: string };

export interface TokenVerifier {
	verify(bearer: string): Promise<TokenVerification>;
}
