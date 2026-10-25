import type { IMessageRepository } from "@remit/data-ports";
import {
	isStorageNotFoundError,
	type StorageService,
} from "@remit/storage-service";
import { BodyParseError, parseMessageBody } from "./body-parse.js";
import { extractSearchText } from "./snippet.js";

const PAGE_SIZE = 200;

interface SearchTextBackfillDeps {
	messageService: Pick<
		IMessageRepository,
		"listMissingSearchText" | "setSearchText" | "syncSearch"
	>;
	storageService: Pick<StorageService, "retrieve">;
}

interface SearchTextBackfillLogger {
	warn(obj: Record<string, unknown>, msg: string): void;
}

interface SearchTextBackfillResult {
	indexed: number;
	skipped: number;
}

const isUnreadableBody = (error: unknown): boolean =>
	error instanceof BodyParseError || isStorageNotFoundError(error);

const recordSearchText = async (
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
	const result: SearchTextBackfillResult = { indexed: 0, skipped: 0 };
	let after = "";
	for (;;) {
		const page = await deps.messageService.listMissingSearchText(
			after,
			PAGE_SIZE,
		);
		const last = page.at(-1);
		if (!last) return result;
		const recorded: string[] = [];
		for (const { messageId, bodyStorageKey } of page) {
			await recordSearchText(deps, messageId, bodyStorageKey).then(
				() => {
					recorded.push(messageId);
				},
				(error: unknown) => {
					if (!isUnreadableBody(error)) throw error;
					result.skipped++;
					log.warn(
						{ messageId, error },
						"Search text backfill skipped an unreadable stored body",
					);
				},
			);
		}
		await deps.messageService.syncSearch(recorded);
		result.indexed += recorded.length;
		after = last.messageId;
	}
};
