import type { IMessageRepository } from "@remit/data-ports";
import type { StorageService } from "@remit/storage-service";
import { parseMessageBody } from "./body-parse.js";
import { extractSearchText } from "./snippet.js";

const PAGE_SIZE = 200;

interface SearchTextBackfillDeps {
	messageService: Pick<
		IMessageRepository,
		"listMissingSearchText" | "setSearchText"
	>;
	storageService: Pick<StorageService, "retrieve">;
}

interface SearchTextBackfillLogger {
	error(obj: Record<string, unknown>, msg: string): void;
}

interface SearchTextBackfillResult {
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
			// A body that cannot be read stays without search text, so the next migrate run tries it again.
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
