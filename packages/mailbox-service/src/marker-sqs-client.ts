import { SQSClient } from "@aws-sdk/client-sqs";
import { resolveSqsCredentials } from "@remit/sqs-client";

/**
 * Shared SQS client construction for a pending-marker service's wake-up-hint
 * enqueue. #1289's `PlacementMoveService` and #1273's `FlagPushService`
 * copy-pasted this exact local-endpoint-derivation + client-construction
 * block; extracted here so a third marker kind does not copy-paste a fourth
 * time (PR #1292 zoom-out).
 *
 * Deliberately NOT a generic marker abstraction — repo convention prefers
 * distinct entities/services per marker kind (`put`/`find`/`updateState`/
 * `delete`/`list*` stay separate, hand-written, per service). This extracts
 * only the genuinely identical non-entity plumbing: constructing the SQS
 * client each marker service's own `enqueue*` method sends through. How that
 * send is issued (FIFO group id, error handling — propagate vs swallow) stays
 * with each caller, since those differ meaningfully between marker kinds.
 */
export const deriveLocalSqsEndpoint = (
	queueUrl: string,
): string | undefined => {
	if (queueUrl.startsWith("http://localhost")) {
		return new URL(queueUrl).origin;
	}
	return undefined;
};

export const createMarkerSqsClient = (
	queueUrl: string,
	explicitEndpoint?: string,
): SQSClient =>
	new SQSClient({
		endpoint: explicitEndpoint ?? deriveLocalSqsEndpoint(queueUrl),
		credentials: resolveSqsCredentials(),
	});
