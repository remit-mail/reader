import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPair, type JWTVerifyGetKey, SignJWT } from "jose";
import type { VerifierConfig } from "./config.js";
import { createJwtVerifier, extractBearerToken } from "./verify.js";

const ISSUER = "http://localhost:5599";
const CONFIG: VerifierConfig = {
	jwksUrl: `${ISSUER}/api/auth/jwks`,
	issuer: ISSUER,
	audience: ISSUER,
};

const keyPair = await generateKeyPair("RS256");
const getKey: JWTVerifyGetKey = async () => keyPair.publicKey;

const sign = (
	claims: Record<string, unknown>,
	overrides: { issuer?: string; audience?: string; expOffset?: number } = {},
): Promise<string> => {
	const jwt = new SignJWT(claims)
		.setProtectedHeader({ alg: "RS256" })
		.setIssuedAt()
		.setIssuer(overrides.issuer ?? ISSUER)
		.setAudience(overrides.audience ?? ISSUER)
		.setExpirationTime(`${overrides.expOffset ?? 900}s`);
	return jwt.sign(keyPair.privateKey);
};

test("verifies a valid RS256 token and returns sub + email", async () => {
	const verify = createJwtVerifier(CONFIG, getKey);
	const token = await sign({ sub: "user-123", email: "a@b.com" });
	const claims = await verify(token);
	assert.equal(claims.sub, "user-123");
	assert.equal(claims.email, "a@b.com");
});

test("rejects a token signed by a different key", async () => {
	const other = await generateKeyPair("RS256");
	const verify = createJwtVerifier(CONFIG, getKey);
	const token = await new SignJWT({ sub: "user-123" })
		.setProtectedHeader({ alg: "RS256" })
		.setIssuedAt()
		.setIssuer(ISSUER)
		.setAudience(ISSUER)
		.setExpirationTime("900s")
		.sign(other.privateKey);
	await assert.rejects(() => verify(token));
});

test("rejects a token with the wrong issuer", async () => {
	const verify = createJwtVerifier(CONFIG, getKey);
	const token = await sign({ sub: "user-123" }, { issuer: "http://evil" });
	await assert.rejects(() => verify(token));
});

test("rejects a token with the wrong audience", async () => {
	const verify = createJwtVerifier(CONFIG, getKey);
	const token = await sign({ sub: "user-123" }, { audience: "http://evil" });
	await assert.rejects(() => verify(token));
});

test("rejects an expired token", async () => {
	const verify = createJwtVerifier(CONFIG, getKey);
	const token = await sign({ sub: "user-123" }, { expOffset: -10 });
	await assert.rejects(() => verify(token));
});

test("rejects an HS256 token (no algorithm downgrade)", async () => {
	const verify = createJwtVerifier(CONFIG, getKey);
	const token = await new SignJWT({ sub: "user-123" })
		.setProtectedHeader({ alg: "HS256" })
		.setIssuedAt()
		.setIssuer(ISSUER)
		.setAudience(ISSUER)
		.setExpirationTime("900s")
		.sign(new TextEncoder().encode("attacker-chosen-shared-secret"));
	await assert.rejects(() => verify(token));
});

test("rejects an unsigned alg:none token", async () => {
	const verify = createJwtVerifier(CONFIG, getKey);
	const b64 = (obj: unknown): string =>
		Buffer.from(JSON.stringify(obj)).toString("base64url");
	const header = b64({ alg: "none", typ: "JWT" });
	const payload = b64({
		sub: "user-123",
		iss: ISSUER,
		aud: ISSUER,
		exp: Math.floor(Date.now() / 1000) + 900,
	});
	const token = `${header}.${payload}.`;
	await assert.rejects(() => verify(token));
});

test("rejects a token without a sub claim", async () => {
	const verify = createJwtVerifier(CONFIG, getKey);
	const token = await sign({ email: "a@b.com" });
	await assert.rejects(() => verify(token), /sub/);
});

test("extractBearerToken parses a Bearer header case-insensitively", () => {
	assert.equal(extractBearerToken("Bearer abc.def.ghi"), "abc.def.ghi");
	assert.equal(extractBearerToken("bearer abc"), "abc");
	assert.equal(extractBearerToken(undefined), undefined);
	assert.equal(extractBearerToken("Basic xyz"), undefined);
	assert.equal(extractBearerToken("Bearer   "), undefined);
});
