import type { ILanguageModel as WayfinderLanguageModel } from "@rbrasier/domain";
import { err, ok, domainError, type ILanguageModel, type Result, type SummaryRequest } from "@redline/redline-domain";

// The redline↔Wayfinder ILanguageModel bridge (delivery-plan §2 item 1).
//
// It lives HERE, in the fork's apps/web, rather than in packages/redline-adapters:
// this app resolves @rbrasier/* and @redline/* alike, while redline-adapters can
// only reach @rbrasier/domain through ADR-0012's optional runtime load — a cost
// with nothing to buy, since the Wayfinder model instance only ever exists in
// this container anyway.
//
// Maps onto Wayfinder's `generateText`, NOT `generateObject<T>`: the latter
// demands a schema and returns `{ object: T }`, which would mean inventing a
// wrapper schema to carry one paragraph of prose.

// `purpose` is required on every Wayfinder call and labels the usage record, so
// redline's summaries are attributable in the same cost ledger as everything else.
const PURPOSE = "redline-product-summary";

const SYSTEM = [
  "You summarise a vendor's tender response for a procurement specialist.",
  "Write one paragraph of plain prose. No preamble, no headings, no lists.",
  "Use only the supplied passages — if they do not support a claim, omit it.",
].join(" ");

const promptFor = (request: SummaryRequest): string =>
  [
    `Vendor: ${request.vendorName}`,
    `Product: ${request.productName}`,
    "Passages:",
    ...request.passages.map((passage, index) => `${index + 1}. ${passage}`),
  ].join("\n");

export class RedlineLanguageModelBridge implements ILanguageModel {
  constructor(private readonly wayfinderModel: WayfinderLanguageModel) {}

  async summarise(request: SummaryRequest): Promise<Result<string>> {
    // A summary with no passages would be the model inventing one, which is
    // worse than no summary at all in an evaluation a specialist signs off.
    if (request.passages.length === 0) {
      return err(
        domainError("VALIDATION_FAILED", "a summary needs at least one passage to condense"),
      );
    }

    const generated = await this.callModel(request);
    if (generated.error) return err(generated.error);

    const text = generated.data.trim();
    if (text === "") {
      return err(domainError("INFRA_FAILURE", "the language model returned an empty summary"));
    }
    return ok(text);
  }

  // Wayfinder's port is Result-returning, but an adapter behind it can still
  // throw (a network stack unwinding, an SDK asserting). Both are contained here
  // so nothing crosses redline's port boundary as an exception.
  private async callModel(request: SummaryRequest): Promise<Result<string>> {
    try {
      const generated = await this.wayfinderModel.generateText({
        purpose: PURPOSE,
        system: SYSTEM,
        prompt: promptFor(request),
      });
      if (generated.error) {
        return err(
          domainError("INFRA_FAILURE", `the language model failed: ${generated.error.message}`),
        );
      }
      return ok(generated.data.text);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "the language model threw", cause));
    }
  }
}
