# ADR-037 — Multi-Tenancy Isolation Model (Decision Doc)

- **Status**: Proposed — **decision required** (no build authorised until accepted)
- **Date**: 2026-07-18

> This ADR exists to make the multi-tenancy decision *before* any code. It frames
> the options and gives a recommendation; it does **not** authorise
> implementation. Product/eng sign-off converts it to Accepted and spawns a PRD
> + phase.

## Context

Wayfinder is **single-tenant today**: one deployment serves one organisation. The
`tenantId` values in the codebase refer to the **Entra/Azure AD tenant** for SSO
(`graph-client.ts`, `auth-methods-card.tsx`), *not* to application-level tenancy.
Every table is one shared dataset; there is no organisation/workspace column and
no per-tenant isolation in queries.

Group-scoped authorization (ADR-036) adds a *sharing/delegation* boundary but
explicitly **not** a data-isolation boundary — two customers must never be
separated only by groups.

The question this ADR forces: **do we stay single-tenant (one deployment per
customer) or introduce true multi-tenancy (many customers in one deployment,
hard-isolated)?** This is architectural and cross-cutting — it touches every
table, query, background job, storage prefix, and the auth model — so it must be
decided deliberately, not drifted into.

## Options

### Option A — Stay single-tenant / dedicated deployment per customer

Each customer gets their own deployment (DB, object storage, config). Isolation
is physical. No app changes.

- **Pros:** strongest isolation (a query bug can't cross customers); simplest data
  model; data residency is per-deployment; no migration; aligns with regulated
  on-prem/VPC buyers who *want* dedicated infra.
- **Cons:** per-customer operational cost and deploy/upgrade fan-out; slower
  onboarding (provision a stack per customer); no shared-SaaS economics; central
  cross-customer admin/analytics is out of band.

### Option B — Pooled multi-tenancy (shared schema, `tenant_id` on every row)

One deployment, one schema; a `tenant_id` column scopes every table, enforced by
Postgres Row-Level Security (RLS) and a tenant-aware repository layer.

- **Pros:** SaaS economics and instant onboarding; one codebase/stack to operate;
  central administration.
- **Cons:** the largest and riskiest change — every query, job, storage path, and
  the auth/session model must become tenant-aware; a single missed filter is a
  cross-tenant data leak; RLS + connection-role discipline is mandatory; data
  residency becomes a per-row concern, not per-deployment; retention, audit
  immutability (ADR-033), and the runtime-config store all need a tenant axis.

### Option C — Bridge / silo hybrid (schema- or database-per-tenant, one app)

One application process, but each tenant gets its own Postgres schema (or
database), selected per request.

- **Pros:** strong isolation (schema/DB boundary) with shared app operations;
  easier residency and per-tenant backup/restore than Option B; less "every query
  needs a filter" risk than pooled.
- **Cons:** connection/schema-routing complexity; migrations fan out across
  schemas; object storage still needs per-tenant prefixing; heavier than A,
  lighter-isolation-risk than B.

## Recommendation

**Default to Option A (dedicated per customer) and do not build B/C until a
concrete SaaS go-to-market requires it.** Rationale:

- Wayfinder's target buyers (procurement, HR, regulated ops) frequently *prefer*
  dedicated/VPC deployments; single-tenant is a feature, not only a limitation.
- ADR-036 already delivers the departmental boundary most single-org customers
  ask for, without isolation risk.
- Pooled multi-tenancy (B) is the highest-blast-radius change in this whole
  enterprise-readiness set; committing to it speculatively risks a cross-tenant
  leak class of bug for economics we may not need yet.

**If** a multi-tenant SaaS offering is committed to, prefer **Option C
(schema-per-tenant)** over B: it buys SaaS operability while keeping a hard
isolation boundary, which is the right risk posture for document-heavy,
regulated workloads.

## Decision

**Open.** Awaiting product/eng sign-off. On acceptance of a specific option,
create `multi-tenancy.prd.md` + a phase doc; until then Wayfinder remains
single-tenant and other enterprise phases (audit, SSO, session, groups) are
designed **single-tenant-first** and must not bake in assumptions that block a
later `tenant_id`/schema axis (e.g. avoid globally-unique assumptions that a
tenant column would break).

## Consequences

- **If A is accepted:** no code change; document the deployment-per-customer model
  and provisioning runbook (ties into the deferred DR/ops posture, gap #12).
- **If B/C is later accepted:** a dedicated, large phase with its own ADR revision;
  every prior enterprise phase is revisited for a tenant axis; RLS or
  schema-routing becomes a first-class, heavily-tested concern.
- **Either way:** keeping this decision explicit prevents accidental drift into a
  half-tenanted state (the worst outcome — partial isolation that looks safe but
  leaks).
