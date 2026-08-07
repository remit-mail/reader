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
	// BETTER_AUTH_URL is the deployment's own public base — the value the token
	// issuer and the JWKS discovery document already agree on — so a minted
	// upload URL resolves from wherever the browser reached the API. Both it and
	// the signing secret are required on the self-host stack; without them a
	// mint fails loud inside the backend rather than handing out a URL that
	// cannot be verified.
	const origin = process.env.BETTER_AUTH_URL;
	const signingSecret = process.env.BETTER_AUTH_SECRET;
	return createFilesystemStorageService(
		basePath,
		origin && signingSecret ? { origin, signingSecret } : undefined,
	);
};
