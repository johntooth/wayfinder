import { EvaluationPivotsContent } from "./_content";

export default async function EvaluationPivotsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EvaluationPivotsContent evaluationId={id} />;
}
