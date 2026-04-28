import { CognitoJwtVerifier } from "aws-jwt-verify";
import type {
	APIGatewayAuthorizerResult,
	APIGatewayTokenAuthorizerEvent,
	APIGatewayTokenAuthorizerHandler,
} from "aws-lambda";

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID ?? "";

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

const getVerifier = () => {
	if (!verifier) {
		verifier = CognitoJwtVerifier.create({
			userPoolId: USER_POOL_ID,
			tokenUse: "id",
		});
	}
	return verifier;
};

/** LRU cache for deletedAt lookups — exported for tests only. */
const cache = new Map<string, { deletedAt: number | undefined; ts: number }>();

export const _testCache = {
	getCachedDeletedAt: (id: string): number | undefined | null => {
		const entry = cache.get(id);
		return entry ? entry.deletedAt : null;
	},
	setCachedDeletedAt: (id: string, deletedAt: number | undefined): void => {
		cache.set(id, { deletedAt, ts: Date.now() });
	},
	size: (): number => cache.size,
	clear: (): void => cache.clear(),
};

const generatePolicy = (
	principalId: string,
	effect: "Allow" | "Deny",
	resource: string,
	context?: Record<string, string>,
): APIGatewayAuthorizerResult => ({
	principalId,
	policyDocument: {
		Version: "2012-10-17",
		Statement: [
			{
				Action: "execute-api:Invoke",
				Effect: effect,
				Resource: resource,
			},
		],
	},
	context,
});

export const handler: APIGatewayTokenAuthorizerHandler = async (
	event: APIGatewayTokenAuthorizerEvent,
) => {
	const token = event.authorizationToken?.replace(/^Bearer\s+/i, "");

	if (!token) {
		throw new Error("Unauthorized");
	}

	try {
		const payload = await getVerifier().verify(token);
		const sub = payload.sub;

		if (!sub) {
			throw new Error("Unauthorized");
		}

		// TODO (#228): check AccountConfig.deletedAt via DDB with LRU cache
		// For now, just validate the JWT and allow — matching the previous
		// Cognito authorizer behavior.

		return generatePolicy(sub, "Allow", event.methodArn, {
			sub,
		});
	} catch {
		throw new Error("Unauthorized");
	}
};
