all: build/remit-openapi3/openapi.json build/remit-client build/drizzle-entities/dist build/drizzle-entities-sqlite/dist build/zod-schemas/schemas.js

build/remit-openapi3/openapi.json: $(shell find typespec/ -type f)
	npx tsp compile ./typespec

build/remit-client: build/remit-openapi3/openapi.json openapi-ts.config.js
	npx @hey-api/openapi-ts
	echo '{"name":"@remit/api-http-client","version":"1.0.0","type":"module","exports":{".":"./index.ts","./*":"./*"}}' > $@/package.json
	touch $@

build/drizzle-entities/dist: build/remit-openapi3/openapi.json
	npm run build --prefix build/drizzle-entities
	touch $@

build/drizzle-entities-sqlite/schema.ts: $(shell find typespec/ -type f)
	npx tsp compile ./typespec --config ./typespec/tspconfig.sqlite.yaml

build/drizzle-entities-sqlite/dist: build/drizzle-entities-sqlite/schema.ts
	npm run build --prefix build/drizzle-entities-sqlite
	touch $@

build/zod-schemas/schemas.js: build/remit-openapi3/openapi.json
	npx tsc -p build/zod-schemas

clean:
	rm -rf build */dist

.PHONY: clean
