import { EvaluationReviewContent } from "./_content";

export default async function EvaluationReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EvaluationReviewContent evaluationId={id} />;
}
