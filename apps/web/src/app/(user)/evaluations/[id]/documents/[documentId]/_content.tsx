"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import type { DocumentView } from "@redline/redline-web";
import { trpc } from "@/trpc/client";

// The document view behind every review row's source deep-link. It binds to the
// framework-free DocumentView the
// `evaluation.document` tRPC procedure returns; the ordering and the anchor the
// `element` query parameter cites are resolved server-side in renderDocumentView,
// so this component owns only the DOM, the scroll and the request state —
// mirroring the review table.

// The cited elem_order. A malformed or negative value is treated as no citation
// rather than sent to the server to be rejected, so a hand-edited URL still
// renders the document.
const citedElement = (raw: string | null): number | undefined => {
  if (raw === null) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return undefined;
  return parsed;
};

function ElementBlock({ element }: { element: DocumentView["elements"][number] }) {
  return (
    <li
      id={element.domId}
      data-testid={element.isAnchor ? "document-anchored-element" : "document-element"}
      className={`scroll-mt-[80px] rounded-[8px] border px-[14px] py-[10px] ${
        element.isAnchor
          ? "border-[#c5d0f7] bg-[#f4f6fd] ring-[2px] ring-[#3a5fd9]"
          : "border-transparent bg-white"
      }`}
    >
      <span className="mb-[4px] block text-[11px] uppercase tracking-[0.05em] text-[#8a857c]">
        {element.page === null ? `Element ${element.elementOrder}` : `Page ${element.page}`}
        {element.isAnchor ? " · cited" : ""}
      </span>
      <p className="whitespace-pre-wrap text-[13px] leading-[1.55] text-[#3a352e]">{element.text}</p>
    </li>
  );
}

function DocumentBody({
  evaluationId,
  documentId,
}: {
  evaluationId: string;
  documentId: string;
}) {
  const element = citedElement(useSearchParams().get("element"));
  const documentQuery = trpc.evaluation.document.useQuery({ evaluationId, documentId, element });
  const view = documentQuery.data;
  const anchorDomId = view?.anchorDomId ?? null;

  // The browser will not act on a fragment for content that arrives after
  // navigation, so the scroll is driven off the resolved anchor once the query
  // settles.
  useEffect(() => {
    if (anchorDomId === null) return;
    window.document.getElementById(anchorDomId)?.scrollIntoView({ block: "center" });
  }, [anchorDomId]);

  if (documentQuery.error) {
    return (
      <p className="text-[13px] text-[#b23b30]" role="alert">
        {documentQuery.error.message}
      </p>
    );
  }
  if (!view) {
    return <p className="text-[13px] text-[#8a857c]">Loading document…</p>;
  }

  return (
    <div className="flex flex-col gap-[12px]">
      <nav className="flex gap-[12px] text-[12px] text-[#3a5fd9]">
        <Link href={view.backToReviewHref} className="hover:underline" data-testid="back-to-review">
          ← Back to review
        </Link>
      </nav>

      <header className="flex flex-col gap-[4px]">
        <h1 className="text-[20px] font-bold text-[#1a1814]">Source document</h1>
        <p className="truncate text-[12px] text-[#6d6a65]" data-testid="document-id">
          {view.documentId}
          {view.anchorPage === null ? "" : ` · cited on page ${view.anchorPage}`}
        </p>
      </header>

      {view.anchorMissing && (
        <p
          className="rounded-[8px] bg-[#fdf3e3] px-[12px] py-[8px] text-[13px] text-[#8a5a1a]"
          role="alert"
          data-testid="document-anchor-missing"
        >
          The cited passage is no longer in this extraction — the document is shown
          from the start.
        </p>
      )}

      {view.isEmpty ? (
        <p className="text-[13px] text-[#6d6a65]" data-testid="document-empty">
          This document has no extracted content yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-[6px]" data-testid="document-elements">
          {view.elements.map((each) => (
            <ElementBlock key={each.elementOrder} element={each} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function EvaluationDocumentContent({
  evaluationId,
  documentId,
}: {
  evaluationId: string;
  documentId: string;
}) {
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-[16px] px-[20px] py-[24px]">
      <Suspense fallback={<p className="text-[13px] text-[#8a857c]">Loading document…</p>}>
        <DocumentBody evaluationId={evaluationId} documentId={documentId} />
      </Suspense>
    </div>
  );
}
