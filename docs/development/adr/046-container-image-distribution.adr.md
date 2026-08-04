# ADR-046 — The Container Image Is the Distribution Unit

- **Status**: Proposed (scoped by `container-distribution.prd.md`)
- **Date**: 2026-08-04
- **Builds on**: ADR-017 (embedding providers — the native-binary constraint on
  the base image), ADR-019 (in-app scheduler) and ADR-033 §6 (extraction worker)
  — the two reasons `api` is a distinct long-lived process, ADR-041 (DB-first
  config — why the image ships no credentials)

## Context

Wayfinder has no container image. Deploying it means cloning a pnpm workspace,
installing, and building — so every deployment guide begins with a build
toolchain rather than with the platform being deployed to. `setup-aws.md` and
`setup-azure.md` each carry a Dockerfile inline, duplicated between them and
built by nothing.

Nothing in CI runs `pnpm build`. `ci.yml` runs typecheck, lint, test and
`validate.sh`; the production build of the web app is not exercised anywhere
before a human runs it during a deployment.

The application is two processes with different shapes:

- `web` — Next.js, serves every user-facing route, and is the only process with
  ingress.
- `api` — Express, plus the scheduler (ADR-019), retention and extraction
  (ADR-033 §6) workers. Almost no inbound traffic; it exists to keep ticking.

They share every package in `packages/`, and a version skew between them means
one half of the app is running different domain logic from the other — a failure
mode with no loud symptom.

Two constraints come from elsewhere and are not negotiable here:

- **glibc.** The local embeddings path (ADR-017) pulls `onnxruntime-node`, a
  native binary with no musl build. Alpine is not available as a base.
- **`VERSION` is read at build time.** `next.config.ts` inlines the repo-root
  `VERSION` file into `NEXT_PUBLIC_APP_VERSION` for the About modal, so the
  build context must include it and the built image is version-stamped.

## Decision

### 1. One image, with the runtime command selecting the process

A single `ghcr.io/rbrasier/wayfinder` image contains both processes. The
platform chooses which one runs:

| Process | Command |
| --- | --- |
| web | `pnpm --filter @wayfinder/web start` |
| api | `pnpm --filter @wayfinder/api start` |
| migrate | the ADR-047 entrypoint |

This is the load-bearing choice, and it is made against image size on purpose.
Two images would let the `api` image drop Next.js and its client dependencies —
a real saving. It would also mean two builds, two vulnerability scans, two tags,
and a live possibility that `web:0.24.0` and `api:0.24.0` were built from
different trees or that a deployer updates one and not the other.

**A version skew between the two processes is a worse failure than a large
image.** Both read the same `packages/domain` entities and the same database;
they must be the same build. One image makes that structurally true rather than
a thing to be careful about.

The saving is also smaller than it looks: `@huggingface/transformers` and
`onnxruntime-node` are needed by whichever process performs embeddings, and they
dominate the image. Splitting removes the smaller half of the problem.

### 2. Published to GHCR, publicly, on release tags

Tag `v*` on a release branch → the workflow builds and pushes
`ghcr.io/rbrasier/wayfinder:<version>`.

- **GHCR** over Docker Hub: same account and permission model as the repository,
  authenticated in Actions with the built-in `GITHUB_TOKEN`, no third-party
  credential to store, and no anonymous pull rate limit to trip cloud runtimes
  during a scale-out.
- **Public**: the deployment guides can say "pull this" with no credential step
  and no `imagePullSecret` in either cloud. The source is already public, so
  publishing the image exposes nothing new.
- The image is **version-stamped and immutable**. A published tag is never
  rebuilt; a bad build gets a new PATCH version.

`latest` is published **only from the current release line, never from `main`**.
`main` is the next release line in active development; a `latest` that tracked it
would hand unfinished work to anyone who omitted a tag.

### 3. The image is built in CI on every pull request

The publish workflow is not the first place the Dockerfile is exercised. `ci.yml`
gains an image-build job on every PR, which is the **first thing in CI to run
`pnpm build`**. That is a benefit in its own right, independent of deployment:
a broken production build becomes a red PR instead of a failed deployment.

The PR job builds and discards. Only the tag workflow pushes.

### 4. The image carries no integration credentials, and no `.env`

Consistent with ADR-041, the image contains application code and nothing
environment-specific. Storage, AI provider, mail and sign-in are configured in
the first-run wizard and stored encrypted in the database. A container's first
boot on a fresh database is expected to land on `/setup`.

`.dockerignore` excludes `.env` explicitly, alongside `node_modules`, `.next`
and `.turbo`.

### 5. The local embedding model is vendored behind a build argument

`scripts/fetch-embeddings-model.mjs` already exists to pre-fetch the model into
the transformers.js cache for air-gapped installs. The Dockerfile exposes it as
a build argument (default off), so the default image stays smaller and an
operator who needs a network-free runtime opts in at build time.

Deliberately a build argument, not a runtime download: a runtime fetch makes the
first embedding call slow, and fails outright in the egress-restricted
environments most likely to need it.

## Alternatives considered

- **Two images, `wayfinder-web` and `wayfinder-api`.** Rejected: see §1. Version
  skew between processes sharing a database is a silent failure; image size is a
  loud one. Revisit if the api image can be made dramatically smaller, which
  requires the embeddings dependency to move out of its path first.
- **No published image; keep the Dockerfile in the repo only.** Rejected: it
  fixes the duplication but leaves every deployer building a pnpm monorepo. The
  published artifact is what changes who can deploy Wayfinder.
- **Docker Hub.** Rejected: a separate account and secret, and anonymous pull
  rate limits that bite exactly when a cloud runtime scales out.
- **Private GHCR.** Rejected for now: it adds a PAT and an `imagePullSecret` to
  every deployment guide, for information already public in the source. Revisit
  if distribution ever needs to be controlled commercially — the workflow does
  not change, only the package visibility.
- **Publishing from `main` as well as release lines.** Rejected: it makes
  `latest` mean "unreleased", which is the opposite of what a deployer omitting a
  tag expects.
- **Next.js `output: "standalone"` in this ADR.** Deferred: it is the right
  long-term answer to image size, but it changes how the web process starts and
  interacts with the workspace layout. Out of scope, recorded in the PRD §11.
- **Alpine base.** Not available — `onnxruntime-node` has no musl build (ADR-017).

## Consequences

**Positive**

- One definition of how Wayfinder is built, exercised on every pull request.
- `pnpm build` is verified in CI for the first time.
- Both cloud guides lose their inline Dockerfile and their build section.
- Deployers consume a versioned artifact; the build toolchain stops being their
  problem.
- `web` and `api` cannot drift, because they cannot be built separately.
- Kubernetes manifests, Helm charts and IaC all become materially cheaper later,
  because each reduces to wiring infrastructure to an existing image.

**Negative**

- **The image is large** — gigabytes even after pruning, because of the native
  embeddings binaries. This is a real cold-start cost on Fargate and Container
  Apps, and it reinforces the min-replicas ≥ 1 guidance already in the Azure
  guide. Mitigations (standalone output, splitting the embeddings path) are
  deferred, not solved.
- The `api` container carries Next.js and the entire web dependency tree it never
  executes. Accepted, per §1.
- CI gets slower: an image build on every PR is minutes, not seconds. Layer
  caching helps; the first build after a lockfile change will not benefit.
- Every published tag is permanently public. Deleting one is possible but not
  clean, so a mistaken publish is close to irreversible.
- A new supply-chain surface. Signing and SBOM generation are follow-ups (PRD
  §11), which means the first published images will be unsigned.
- Single-architecture (`amd64`) initially, so Graviton and Azure Ampere targets
  are excluded until multi-arch lands.
