import type { IMessageRepository } from "@remit/data-ports";
import type { StorageService } from "@remit/storage-service";
import { parseMessageBody } from "./body-parse.js";
import { extractSearchText } from "./body-sync.js";

const PAGE_SIZE = 200;

export interface SearchTextBackfillDeps {
	messageService: Pick<
		IMessageRepository,
		"listMissingSearchText" | "setSearchText"
	>;
	storageService: Pick<StorageService, "retrieve">;
}

export interface SearchTextBackfillLogger {
	error(obj: Record<string, unknown>, msg: string): void;
}

export interface SearchTextBackfillResult {
	indexed: number;
	failed: number;
}

const indexStoredBody = async (
	deps: SearchTextBackfillDeps,
	messageId: string,
	bodyStorageKey: string,
): Promise<void> => {
	const parsed = await parseMessageBody(
		await deps.storageService.retrieve(bodyStorageKey),
	);
	await deps.messageService.setSearchText(messageId, extractSearchText(parsed));
};

/**
 * Record the search text of every message whose body was stored before search
 * text was (#1444), from the stored raw source, and index it. A message whose
 * body cannot be read or parsed is logged and passed over, so one bad object
 * does not hold back the rest; it stays in the cohort and the next run tries
 * it again.
 */
export const backfillSearchText = async (
	deps: SearchTextBackfillDeps,
	log: SearchTextBackfillLogger,
): Promise<SearchTextBackfillResult> => {
	const result: SearchTextBackfillResult = { indexed: 0, failed: 0 };
	let after = "";
	for (;;) {
		const page = await deps.messageService.listMissingSearchText(
			after,
			PAGE_SIZE,
		);
		const last = page.at(-1);
		if (!last) return result;
		for (const { messageId, bodyStorageKey } of page) {
			await indexStoredBody(deps, messageId, bodyStorageKey).then(
				() => {
					result.indexed++;
				},
				(error: unknown) => {
					result.failed++;
					log.error(
						{ messageId, error },
						"Search text backfill could not read the stored body",
					);
				},
			);
		}
		after = last.messageId;
	}
};
