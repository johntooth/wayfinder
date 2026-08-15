import { EvaluationGroupingContent } from "./_content";

export default async function EvaluationGroupingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ populationError?: string }>;
}) {
  const { id } = await params;
  const { populationError } = await searchParams;
  return (
    <EvaluationGroupingContent evaluationId={id} populationError={populationError ?? null} />
  );
}
