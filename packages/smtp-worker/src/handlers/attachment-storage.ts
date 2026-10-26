import type { StorageService } from "@remit/storage-service";

export type AttachmentReader = Pick<StorageService, "retrieveOutboxAttachment">;

/**
 * Where this worker reads a message's files from, built on the first read.
 *
 * Without a bucket the storage factory falls back to the local filesystem,
 * which a Lambda does not have: every read would come back empty and blame the
 * file. The check runs on the first read rather than at start, so a deployment
 * not yet given the bucket still sends every message that carries no files.
 */
export const createAttachmentReader = (
	processEnv: NodeJS.ProcessEnv,
	createStorage: () => StorageService,
): AttachmentReader => {
	let storage: StorageService | null = null;
	return {
		retrieveOutboxAttachment: (...args) => {
			if (processEnv.AWS_LAMBDA_FUNCTION_NAME && !processEnv.S3_BUCKET_NAME) {
				throw new Error(
					"S3_BUCKET_NAME is not set on this worker, so it has no attachment storage to read from",
				);
			}
			if (!storage) storage = createStorage();
			return storage.retrieveOutboxAttachment(...args);
		},
	};
};
