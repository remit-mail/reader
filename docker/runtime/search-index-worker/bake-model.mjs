#!/usr/bin/env node
// Downloads and caches the local embedding model into the image at build
// time (RFC 035 D2/FAQ: "trading size for reproducible, offline-capable
// startup"). Mirrors the exact pipeline call
// remit-search-service/src/embeddings.ts makes at runtime — same task, same
// model id — so the cache this populates is the cache the app reads.
import { pipeline } from "@huggingface/transformers";

const modelId =
	process.env.SEARCH_EMBEDDING_MODEL_ID ??
	"Xenova/paraphrase-multilingual-MiniLM-L12-v2";

console.log(`bake-model: downloading ${modelId}`);
await pipeline("feature-extraction", modelId);
console.log("bake-model: done");
