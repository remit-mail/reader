import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { ForbiddenError } from "@remit/remit-electrodb-service";
import { logger } from "@remit/logger-lambda";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { env } from "expect-env";
import type { Context } from "openapi-backend";
import { sqsClient } from "../service/sqs.js";
import type {
	AdminAccountConfigOperationIds,
	OperationHandler,
} from "../types.js";

const getCognitoGroups = (event: APIGatewayProxyEvent): string[] => {
	const claims = event.requestContext?.authorizer?.claims;
	if (!claims) return [];
	const groups = claims["cognito:groups"];
	if (typeof groups === "string") return groups.split(",").map((g) => g.trim());
	if (Array.isArray(groups)) return groups as string[];
	return [];
};

export const AdminAccountConfigOperations: Record<
	AdminAccountConfigOperationIds,
	OperationHandler<AdminAccountConfigOperationIds>
> = {
	AdminAccountConfigOperations_adminFinalizeDelete: async (
		context: Context,
		...args: unknown[]
	): Promise<Record<string, unknown>> => {
		const event = args[0] as APIGatewayProxyEvent;
		const { accountConfigId } = context.request.params as {
			accountConfigId: string;
		};

		const groups = getCognitoGroups(event);
		if (!groups.includes("admins")) {
			throw new ForbiddenError("Only admins can finalize account deletion");
		}

		const queueUrl = env.SQS_QUEUE_URL_ACCOUNT_FINALIZE;

		await sqsClient.send(
			new SendMessageCommand({
				QueueUrl: queueUrl,
				MessageBody: JSON.stringify({
					type: "FinalizeAccountDelete",
					accountConfigId,
				}),
			}),
		);

		logger.info({ accountConfigId }, "Account finalize-delete enqueued");

		return { statusCode: 204 };
	},
};
