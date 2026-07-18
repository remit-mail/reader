import { S3Client } from "@aws-sdk/client-s3";
import { createFilesystemStorageService } from "./backends/filesystem.js";
import { createS3StorageService } from "./backends/s3.js";
import type { StorageService } from "./storage.js";

export { createS3StorageService } from "./backends/s3.js";

export const createStorageService = (): StorageService => {
	const bucketName = process.env.S3_BUCKET_NAME;

	if (bucketName) {
		const client = new S3Client({
			endpoint: process.env.S3_ENDPOINT,
		});
		return createS3StorageService(client, bucketName);
	}

	const basePath = process.env.STORAGE_LOCAL_PATH ?? ".remit/storage";
	return createFilesystemStorageService(basePath);
};
