# Bug fix — stream-json prototype-pollution advisories, by replacing the `minio` client

- **Version**: 0.41.2 — **PATCH** (dependency and adapter change, no schema impact)
- **Date**: 2026-11-06
- **Base branch**: `release/alpha-3`

## Approved change summary

Replace the `minio` npm client with `@aws-sdk/client-s3` in the object-storage
adapter and the storage connectivity probe. `minio` is the only path to
`stream-json`, and no override can move it to a patched version. The adapter's
contract, its `MINIO_*` settings and its behaviour don't change. Removing
`minio` also removes `query-string` and `decode-uri-component` from the
dependency graph, so 0.41.1's `query-string` patch and `decode-uri-component`
override go too.

## Advisories

| Advisory | Package | Affected | Patched |
|---|---|---|---|
| GHSA-528h-pc64-c93x (Moderate) | stream-json | `<= 3.4.0` | 3.5.0 |
| GHSA-hqr4-qq8f-hg3x (Moderate) | stream-json | `<= 3.5.0` | 3.6.0 |
| GHSA-mjw6-4jj6-33hc (Moderate) | stream-json | `< 3.6.0` | 3.6.0 |

`pnpm audit` reported all three on `release/alpha-3` and `main`. They are
moderate, so the high/critical audit gate passes; they still show as open alerts.

## Root cause (verified)

- **Only one consumer.** `stream-json@1.9.1` reaches the workspace only
  through `minio@8.0.7`, which depends on `^1.8.0`. `minio` 8.0.7 is the latest
  release.
- **No override is possible.** stream-json 3.x is ESM-only, and it renamed the
  file `minio` loads. `minio`'s CommonJS build calls
  `require("stream-json/jsonl/Parser.js")`, and 3.x ships
  `src/jsonl/parser.js`. That `require` sits in `minio`'s notification module,
  which its main entry loads, so an override would break the storage client
  at import.
- **Not reachable today.** `minio` uses only the JSONL parser, and only for
  bucket notifications, which Wayfinder never calls. The vulnerable code is
  stream-json's `Assembler`. So this is a dependency-graph fix, not an
  exploitable-path fix.

## Fix applied

- `packages/adapters/src/storage/s3-client.ts` (new): one place that builds the
  S3 client config from `StorageConfig`, plus `bucketExists` and `isNotFound`.
  The adapter and the probe both use it, as they shared `minioClientOptions`
  before.
- Behaviour kept from `minio`:
  - **Blank region.** `minio` discovered the region per bucket. The SDK needs a
    region to sign, so it signs `us-east-1` and follows S3's redirect to the
    bucket's real region (`followRegionRedirects`). A configured region is used
    as-is.
  - **Endpoint.** `MINIO_ENDPOINT` stays a host. Scheme and port come from
    `MINIO_USE_SSL` and `MINIO_PORT`.
  - **Addressing.** `MINIO_PATH_STYLE` maps to `forcePathStyle`.
  - **Checksums.** Only the checksums an operation requires
    (`WHEN_REQUIRED`). Since 3.729 the SDK defaults to adding CRC32 to every
    upload, which not every S3-compatible server accepts. `minio` never sent it.
  - **Not found.** `NotFound`, `NoSuchKey`, `NoSuchBucket`, or a bare 404 (HEAD
    responses have no body). As before, this maps to `NOT_FOUND` on `get` and
    to `false` on `exists`.
- `minio-storage.ts`: same class and contract. It now sends SDK commands, and
  takes an optional client factory so tests can use a fake `send` instead of
  `vi.mock`.
- `connectivity-probes.ts`: the default factory wraps `bucketExists`. The
  probe's structural `{ bucketExists }` seam is unchanged.
- Removed: `minio`, `minio-client-options.ts` and its test,
  `patches/query-string@7.1.3.patch` with its `patchedDependencies` entry, the
  `decode-uri-component` override, and the Dockerfile's `COPY patches/`.
  `scripts/lockfile-advisories.test.mjs` keeps its `decode-uri-component` floor
  as a guard in case it comes back.
- `@aws-sdk/client-s3` is pinned at 3.1160.0, eight days old at the time of the
  change, rather than the release from the day before.

## Regression tests

- `s3-client.test.ts` (new, 11 tests): endpoint, credentials, addressing,
  blank versus set region, checksum mode, not-found recognition, and
  `bucketExists` true / false / rethrow.
- `minio-storage.test.ts` (rewritten, 13 tests): every case the `minio` version
  had, against SDK commands and their inputs, plus a missing body on `get`
  and a failed `exists` check that must not read as "absent".
- Probe tests are unchanged and pass.

## Verification

- Against a real SeaweedFS (the pinned `chrislusf/seaweedfs:4.47` image the
  compose files and CI use): probe reports the bucket missing, `initialise`
  creates it, a second `initialise` sees it, the probe then passes, `put` → `get`
  returns identical bytes (64 KB, non-ASCII), `exists` true and false, `get` of
  a missing key is `NOT_FOUND`, `delete` then `exists` is false, and a wrong
  secret gives `INFRA_FAILURE`.
- `pnpm audit`: no stream-json advisories; `stream-json`, `minio`,
  `query-string` and `decode-uri-component` are absent from `pnpm-lock.yaml`.
- Not verified against Amazon S3 itself, including the region redirect for a
  blank region. The e2e suite exercises storage against SeaweedFS in CI.

## E2E

None added. The upload and download specs already run every adapter path
against SeaweedFS in CI; the adapter's unit tests are the regression guard.

## Known limitations

- The class, the probe factory type and the env vars keep the `Minio` / `MINIO_`
  names, to keep this fix small. They have described generic S3 settings since
  SeaweedFS replaced MinIO.
- `main` is already at 0.41.2 from the last forward merge, so this version
  collides with it there. The forward merge will need its own number.
