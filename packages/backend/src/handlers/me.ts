import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { BadRequestError } from "@remit/remit-electrodb-service";
import { logger } from "@remit/remit-logger-lambda";
import type {
	DeleteAccountConfigResponse,
	DeleteMeInput,
	VipSuggestionsResponse,
} from "@remit/api-openapi-types";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { env } from "expect-env";
import type { Context } from "openapi-backend";
import { getAccountConfigIdFromEvent } from "../auth.js";
import { getClient } from "../service/dynamodb.js";
import { sqsClient } from "../service/sqs.js";
import type { MeOperationIds, OperationHandler } from "../types.js";
import { toVipSuggestionEntry } from "./vip-suggestions.js";

export const MeOperations: Record<
	MeOperationIds,
	OperationHandler<MeOperationIds>
> = {
	MeOperations_listVipSuggestions: async (
		_context: Context,
		...args: unknown[]
	): Promise<VipSuggestionsResponse> => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);

		const { address } = getClient();
		const items = await address.listSuggestedVips({ accountConfigId });

		return { suggestions: items.map(toVipSuggestionEntry) };
	},
	MeOperations_deleteMe: async (
		_context: Context,
		...args: unknown[]
	): Promise<DeleteAccountConfigResponse> => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);

		const { confirmEmail } = JSON.parse(
			event.body ?? "{}",
		) as Partial<DeleteMeInput>;
		const callerEmail = event.requestContext?.authorizer?.claims?.email as
			| string
			| undefined;

		if (typeof confirmEmail !== "string" || confirmEmail.trim() === "") {
			throw new BadRequestError("confirmEmail is required");
		}

		if (!callerEmail) {
			throw new BadRequestError("Account email claim missing from token");
		}

		if (confirmEmail.toLowerCase() !== callerEmail.toLowerCase()) {
			throw new BadRequestError(
				"confirmEmail does not match your account email",
			);
		}

		const { accountConfig } = getClient();

		try {
			await accountConfig.update(accountConfigId, {
				state: "deleting",
				deletedAt: Date.now(),
			});
		} catch (err: unknown) {
			// If already in "deleting" state, treat as idempotent
			if (
				err instanceof Error &&
				(err.name === "ConditionalCheckFailedException" ||
					err.message.includes("ConditionalCheckFailed"))
			) {
				return {
					statusCode: 202,
					message: "Account deletion already in progress",
				};
			}
			throw err;
		}

		const queueUrl = env.SQS_QUEUE_URL_ACCOUNT_FANOUT;

		await sqsClient.send(
			new SendMessageCommand({
				QueueUrl: queueUrl,
				MessageBody: JSON.stringify({
					type: "AccountDelete",
					accountConfigId,
				}),
			}),
		);

		logger.info({ accountConfigId }, "Account deletion initiated");

		return {
			statusCode: 202,
			message: "Account deletion initiated",
		};
	},
};
