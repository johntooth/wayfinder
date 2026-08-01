import { EvaluationGroupingContent } from "./_content";

export default async function EvaluationGroupingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EvaluationGroupingContent evaluationId={id} />;
}
