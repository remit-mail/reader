import type { SemanticSearchResult } from "@remit/api-openapi-types";
import type { SearchResult } from "@remit/search-service";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import { getAccountConfigIdFromEvent } from "../auth.js";
import { getClient } from "../service/dynamodb.js";
import type { OperationHandler, SemanticSearchOperationIds } from "../types.js";

const DEFAULT_LIMIT = 25;

const toResponse = (item: SearchResult): SemanticSearchResult => {
	const result: SemanticSearchResult = {
		messageId: item.messageId,
		threadId: item.threadId,
		score: item.score,
		matchedChunkType: item.matchedChunkType,
		mailboxIds: item.mailboxIds,
		sentDate: item.sentDate,
	};
	// fromName is null for messages with no sender name; exclude undefined (absent from old vectors)
	if (item.fromName !== undefined) {
		result.fromName = item.fromName ?? undefined;
	}
	if (item.subject !== undefined) {
		result.subject = item.subject;
	}
	return result;
};

export const SemanticSearchOperations: Record<
	SemanticSearchOperationIds,
	OperationHandler<SemanticSearchOperationIds>
> = {
	SemanticSearchOperations_semanticSearch: async (
		context: Context,
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const {
			query,
			mailboxId,
			sentDateFrom,
			sentDateTo,
			hasAttachment,
			hasStars,
			isRead,
			limit,
		} = context.request.query as {
			query: string;
			mailboxId?: string;
			sentDateFrom?: number;
			sentDateTo?: number;
			hasAttachment?: boolean;
			hasStars?: boolean;
			isRead?: boolean;
			limit?: number;
		};

		const sentDateRange =
			sentDateFrom !== undefined || sentDateTo !== undefined
				? { from: sentDateFrom, to: sentDateTo }
				: undefined;

		const results = await getClient().search.search({
			query,
			accountConfigId,
			mailboxId,
			sentDateRange,
			hasAttachment,
			hasStars,
			isRead,
			limit: limit ?? DEFAULT_LIMIT,
		});

		return {
			items: results.map(toResponse),
		};
	},
};
