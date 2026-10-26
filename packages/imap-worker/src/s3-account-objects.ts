import {
	DeleteObjectsCommand,
	ListObjectsV2Command,
	S3Client,
} from "@aws-sdk/client-s3";
import type { AccountObjectStore } from "./context.js";

const PAGE_SIZE = 1_000;

export const s3AccountObjects = (
	bucket: () => string,
	s3: S3Client = new S3Client({}),
): AccountObjectStore => ({
	list: async (prefix, continuationToken) => {
		const result = await s3.send(
			new ListObjectsV2Command({
				Bucket: bucket(),
				Prefix: prefix,
				MaxKeys: PAGE_SIZE,
				ContinuationToken: continuationToken,
			}),
		);
		return {
			keys: (result.Contents ?? [])
				.map((object) => object.Key)
				.filter((key): key is string => key !== undefined),
			nextContinuationToken: result.IsTruncated
				? result.NextContinuationToken
				: undefined,
		};
	},
	delete: async (keys) => {
		await s3.send(
			new DeleteObjectsCommand({
				Bucket: bucket(),
				Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
			}),
		);
	},
});
