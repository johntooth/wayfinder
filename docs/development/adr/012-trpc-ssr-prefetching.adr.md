# ADR 012 — tRPC Server-Side Prefetching Strategy

- **Status**: Accepted
- **Date**: 2026-05-23
- **Deciders**: rbrasier

---

## Context

Admin and user pages each fire 2–4 independent `useQuery` calls on mount.
Because all pages are currently pure client components with no server-side data,
the browser must:

1. Download and hydrate the page JS bundle.
2. Fire tRPC queries from each mounted component.
3. Wait for responses before rendering meaningful content.

React Query deduplicates in-flight requests for the same cache key, but only
when multiple components fire queries within the same event-loop tick. When
components mount across separate render cycles (layout → page content → nested
component), each triggers its own HTTP round-trip.

Observed impact: `/admin/flows` produces four separate `flow.list` network
requests on first visit (1 batched with other queries + 3 sequential).

---

## Decision

Use **`createHydrationHelpers`** from `@trpc/react-query/rsc` (tRPC v11 RSC
API, already installed at `11.17.0`).

This API was chosen over alternatives (see §Alternatives) because it is the
first-party, RSC-aware tRPC v11 API and works with the existing
`@tanstack/react-query` v5 dehydration/hydration infrastructure.

### Pattern

```
Server component (layout / page)
  ├─ createServerTrpcContext()      ← reads cookie via next/headers
  ├─ createCallerFactory(router)(ctx)
  ├─ createHydrationHelpers(caller, getQueryClient)
  ├─ void trpc.<router>.<proc>.prefetch(input)   ← fills QueryClient
  └─ <HydrateClient>                ← dehydrates + sends to browser
       └─ children (client components)
            └─ trpc.<router>.<proc>.useQuery()   ← hits hydrated cache, no fetch
```

A shared `getQueryClient = cache(createQueryClient)` (React `cache()`) ensures
the same `QueryClient` instance is reused across nested server components within
a single request (layout + nested pages both call `getQueryClient()` and get the
same object).

### Required QueryClient configuration

`createHydrationHelpers` requires that both the server-side and client-side
`QueryClient` instances have their transformer's `serialize`/`deserialize`
functions registered so that superjson-encoded data survives the
dehydration/hydration boundary:

```typescript
new QueryClient({
  defaultOptions: {
    dehydrate: { serializeData: superjson.serialize },
    hydrate:   { deserializeData: superjson.deserialize },
  },
})
```

This change is applied to a shared `createQueryClient()` factory used by both
the server helpers and the client `TrpcProvider`.

---

## Alternatives considered

| Option | Reason rejected |
|--------|----------------|
| `createServerSideHelpers` (`@trpc/react-query/server`) | Older API predating RSC support; `createHydrationHelpers` is the v11 RSC-native replacement |
| Manual `createCallerFactory` + `QueryClient.prefetchQuery` | More boilerplate; requires manually constructing tRPC query keys; `createHydrationHelpers` handles key generation automatically |
| Increase `staleTime` only | Does not eliminate the initial client-side round-trip; only reduces repeat fetches |
| Next.js `fetch` with `cache` option | Bypasses tRPC entirely; loses type safety and tRPC middleware (auth, error logging) |

---

## Consequences

- **Positive**: Initial page load for admin and user pages delivers pre-populated
  data with no client-side fetch waterfall.
- **Positive**: Existing `useQuery` hooks require no changes — they automatically
  pick up the hydrated cache.
- **Neutral**: Mutations still use `utils.*.invalidate()` to trigger re-fetches
  after writes; SSR data is for initial load only.
- **Negative**: Each server layout/page must `await createServerTrpcContext()`,
  which reads cookies and resolves the session. This adds one DB call per page
  server render. Acceptable given the session lookup is a single indexed key
  read.
- **Negative**: Dynamic route pages (`/admin/flows/[id]`, `/chats/[sessionId]`)
  require that `page.tsx` become an async server component wrapping a `_content.tsx`
  client component — a one-time structural split per page.
