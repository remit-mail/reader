import { PassThrough } from "node:stream";
import type { Logger } from "@remit/logger-lambda";
import type { StorageService } from "@remit/storage-service";
import { ZipArchive } from "archiver";
import type { CascadeServices } from "../cascade.js";
import { getCascadeServices, getStorageService } from "../config.js";
import type { AccountExportEvent } from "../events.js";

const THIRTY_DAYS_MILLIS = 30 * 24 * 60 * 60 * 1000;

export interface ProcessAccountExportDeps {
	services: CascadeServices;
	storageService: StorageService;
}

const defaultDeps = async (): Promise<ProcessAccountExportDeps> => ({
	services: await getCascadeServices(),
	storageService: getStorageService(),
});

const appendMessageBodies = async (
	archive: ZipArchive,
	accountConfigId: string,
	services: CascadeServices,
	storageService: StorageService,
	log: Logger,
): Promise<number> => {
	const { accountConfigService, accountService, messageService } = services;
	let appended = 0;

	const accountConfigDescription =
		await accountConfigService.describe(accountConfigId);

	for (const account of accountConfigDescription.account) {
		const accountDescription = await accountService.describe(account.accountId);

		for (const mailbox of accountDescription.mailbox) {
			const messages = await messageService.listAllByMailbox(mailbox.mailboxId);

			for (const message of messages) {
				const body = await storageService.retrieveMessageBodyStream(
					accountConfigId,
					account.accountId,
					message.messageId,
				);

				if (!body) {
					log.info(
						{ accountConfigId, messageId: message.messageId },
						"No raw body for message, skipping",
					);
					continue;
				}

				archive.append(body, {
					name: `accounts/${account.accountId}/${mailbox.fullPath ?? mailbox.mailboxId}/${message.messageId}.eml`,
				});
				appended += 1;
			}
		}
	}

	return appended;
};

export const processAccountExport = async (
	event: AccountExportEvent,
	log: Logger,
	deps?: ProcessAccountExportDeps,
): Promise<void> => {
	const { accountConfigId, accountExportRequestId } = event;
	const { services, storageService } = deps ?? (await defaultDeps());
	const { accountExportRequestService } = services;

	await accountExportRequestService.get(accountExportRequestId);
	await accountExportRequestService.update(accountExportRequestId, {
		state: "Processing",
	});
	log.info(
		{ accountConfigId, accountExportRequestId },
		"Export processing started",
	);

	try {
		const archive = new ZipArchive({ zlib: { level: 6 } });
		const passthrough = new PassThrough();
		archive.pipe(passthrough);

		const uploadDone = storageService.storeExportArchiveStream(
			accountConfigId,
			accountExportRequestId,
			passthrough,
		);

		const archiveSettled = new Promise<void>((resolve, reject) => {
			archive.on("warning", reject);
			archive.on("error", reject);
			archive.on("end", resolve);
		});

		const entryCount = await appendMessageBodies(
			archive,
			accountConfigId,
			services,
			storageService,
			log,
		);

		await archive.finalize();
		await archiveSettled;
		const objectKey = await uploadDone;

		const expiresAt = Date.now() + THIRTY_DAYS_MILLIS;

		await accountExportRequestService.update(accountExportRequestId, {
			state: "Ready",
			objectKey,
			expiresAt,
		});

		log.info(
			{ accountConfigId, accountExportRequestId, entryCount },
			"Export ready",
		);
	} catch (error) {
		await accountExportRequestService.update(accountExportRequestId, {
			state: "Failed",
			errorMessage: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
};
