import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import type { VerifierConfig } from "./config.js";

export interface JwtClaims {
	sub: string;
	email?: string;
}

export type JwtVerifier = (token: string) => Promise<JwtClaims>;

/**
 * Verify a better-auth RS256 JWT against its JWKS, offline (no session lookup).
 *
 * `getKey` is injectable so the verification path can be unit-tested against a
 * local key pair without a running JWKS endpoint; in production it defaults to a
 * cached remote JWKS that follows key rotation.
 */
export const createJwtVerifier = (
	config: VerifierConfig,
	getKey?: JWTVerifyGetKey,
): JwtVerifier => {
	const jwks = getKey ?? createRemoteJWKSet(new URL(config.jwksUrl));

	return async (token: string): Promise<JwtClaims> => {
		const { payload } = await jwtVerify(token, jwks, {
			issuer: config.issuer,
			audience: config.audience,
			algorithms: ["RS256"],
		});

		const sub = payload.sub;
		if (typeof sub !== "string" || sub.length === 0) {
			throw new Error("JWT is missing a usable `sub` claim");
		}

		const email = typeof payload.email === "string" ? payload.email : undefined;
		return { sub, email };
	};
};

const BEARER_PREFIX = /^Bearer\s+/i;

export const extractBearerToken = (
	authorization: string | undefined,
): string | undefined => {
	if (!authorization) return undefined;
	if (!BEARER_PREFIX.test(authorization)) return undefined;
	const token = authorization.replace(BEARER_PREFIX, "").trim();
	return token.length > 0 ? token : undefined;
};
