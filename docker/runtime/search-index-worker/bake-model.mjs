#!/usr/bin/env node
// Downloads and caches the local embedding model into the image at build
// time (RFC 035 D2/FAQ: "trading size for reproducible, offline-capable
// startup"). Mirrors the exact pipeline call
// remit-search-service/src/embeddings.ts makes at runtime — same task, same
// model id, same dtype — so the cache this populates is the cache the app
// reads. SEARCH_EMBEDDING_DTYPE=q8 downloads only the int8-quantized
// model_quantized.onnx (~118MB) instead of the fp32 model.onnx (~470MB); the
// runtime must load with the same dtype or it would look for the file this
// bake never fetched.
import { pipeline } from "@huggingface/transformers";

const modelId =
	process.env.SEARCH_EMBEDDING_MODEL_ID ??
	"Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const dtype = process.env.SEARCH_EMBEDDING_DTYPE || undefined;

console.log(`bake-model: downloading ${modelId} (dtype=${dtype ?? "fp32"})`);
await pipeline("feature-extraction", modelId, { dtype });
console.log("bake-model: done");
