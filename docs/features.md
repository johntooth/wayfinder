# Wayfinder — Features

_Last updated: 5 August 2026_

This document provides a detailed breakdown of Wayfinder's features. For a high-level summary see the [README](../README.md).

Wayfinder exists to let a **non-technical person run a complex, document-producing process end to end** — governed, auditable, and without writing code or prompts. The sections below are ordered by how directly they serve that purpose: what the end user experiences first, then what they walk away with, then the governance around it, then the machinery that makes it configurable.

---

## The Guided Session

What the end user actually touches. A session is the process, made conversational.

### Chat Interface
Users start sessions on published flows from a dedicated chat screen. Each session is a streaming, multi-turn conversation powered by a LangGraph state machine compiled from the flow's node graph. The AI gathers information step-by-step, signals its confidence after each reply, and advances to the next step automatically when confidence reaches the threshold.

_Why it matters:_ This is the whole premise. The user does not need to know the process, the prompt, or the document — they answer questions. Traditional forms are static and can't adapt to what a user has already said; a conversational interface lets the AI ask intelligent follow-up questions, catch ambiguities, and guide users naturally through a complex process.

### Structured AI Turns
Each AI reply is generated as both a streaming text response (for immediate display) and a structured confidence assessment (via parallel `streamObject`). The confidence score and a `readyToAdvance` flag determine whether the step is complete. This separation keeps the conversational reply natural while giving the system a reliable signal for step progression.

_Why it matters:_ This is what makes the workflow *structured* rather than open-ended. Without a scored, structured signal, step advancement would rest on heuristics, and "the process was followed" would be an assertion rather than a fact the system can show.

### AI Transparency Modals
Users can open a transparency modal on any AI message to see the model's reasoning, which information sources were used, and the exact confidence score that was returned. The modal presents this in plain language, not raw JSON.

_Why it matters:_ An operator is accountable for the output even though the AI produced it. Plain-language reasoning, sources, and scores let them defend or challenge what the AI concluded — without reading JSON or trusting it blindly.

### Step Completion Confirmation
Flow authors can require a step to pause for explicit operator confirmation once the AI considers it complete, instead of auto-advancing. The user keeps chatting while a "Proceed" prompt waits in the footer, giving them a moment to review before the step hands over.

_Why it matters:_ Some steps carry consequences a user should consciously confirm — sign-off style moments where silent auto-advance feels wrong. A per-node toggle lets authors choose the right handover behaviour per step.

### Branch-Aware Context
When a flow has multiple outgoing edges from a step (a branching node), a separate AI call selects which branch to take. The branch-choice prompt includes each candidate step's purpose (its completion criteria and instructions) and requests a written rationale before committing to a branch.

_Why it matters:_ Real processes fork — different procurement thresholds, different contract types, different risk tiers. Routing has to be reliable enough that the user never has to know a fork happened, and the written rationale means a reviewer can check the turn the process took.

### Real-time Collaborative Sessions
Multiple authenticated users can participate in the same session simultaneously via a shared link. All participants can send messages; new messages and AI replies propagate to every open window within a few seconds. A typing indicator shows when another participant is composing a message.

_Why it matters:_ Document-heavy processes rarely have a single owner. Collaboration lets a subject-matter expert and a document author work through a session together, instead of one person relaying questions to the other and retyping the answers.

### Auto-Send Kickoff Message
A freshly created session automatically sends an opening, user-authored message referencing the flow (and its first step, where known) so the AI responds immediately instead of leaving the user on an empty thread.

_Why it matters:_ A blank chat window asks the user to work out how to start — exactly the burden Wayfinder is meant to remove. Opening the conversation for them gets them into the guided path with zero friction.

### Grouped Follow-up Questions
The AI can batch closely related follow-up questions into a single message when it's natural to do so, rather than being constrained to ask strictly one question at a time.

_Why it matters:_ Some steps naturally need a few closely related pieces of information (name, date, amount) that a person would ask for together. Allowing grouped questions keeps the conversation feeling natural instead of needlessly slow.

### Session File Upload
Users can upload files during a live session. Uploaded files are processed immediately and added to the AI's context for that session, allowing users to supply supporting documents on the fly rather than requiring flow owners to pre-load all possible reference material.

_Why it matters:_ The user usually holds the document the step actually turns on — a contract draft, a scanned form, a supplier response. Letting them hand it over mid-conversation keeps the process moving instead of stalling on an admin request.

---

## The Document at the End

Most Wayfinder processes exist to produce a document. Everything here is about that document being complete, correctly typed, and trustworthy.

### DOCX Document Generation
Flow steps configured with output type `generate_document` automatically fill a Word document template with information gathered during the conversation. The filled document is stored in object storage (MinIO or S3) and presented to the user as a downloadable card in the chat.

_Why it matters:_ The deliverable is the point. Generating it directly from the conversation removes the manual re-keying step between "we discussed it" and "it's written down" — the step where errors and delays actually accumulate.

### Template Field Annotations
Template `{{ tags }}` support inline type annotations — `(date)`, `(currency)`, `(email)`, `(yesno)`, `(options: A, B, C)`, `(maxlen: 200)`, and so on. The annotation is parsed at upload time, stored in the node configuration, and injected into the AI's system prompt so it reformats user input to the required type before inserting it into the document.

_Why it matters:_ A document that goes to a supplier, a regulator, or a court has to be consistent. Annotations let the flow owner state the required shape once, in the template they already own, instead of hoping a prompt holds the line on date and currency formats.

### Pre-Generation Evaluation Gate
For `generate_document` steps, the high-quality document-generation model extracts and grades the template fields *before* the step advances, not just afterwards as an audit step. If the grade falls short of the node's confidence threshold the step holds and the AI immediately asks a targeted follow-up about what's missing; a passing grade is reused for generation, so a pass costs no extra AI calls versus the old post-hoc check.

_Why it matters:_ An incomplete document that already exists is a problem someone has to notice and unwind. Gating on the evaluation *before* advancing means the conversation fills the gap while the user is still in it — the difference between a guided process and a post-hoc review queue.

### Narrative & Optional Sections
Flow steps can produce free-form narrative text in addition to tagged fields. Sections of a template can also be marked as optional and will only be included in the generated document when the conversation outcome warrants it.

_Why it matters:_ Real documents summarise context in prose and carry sections that only apply in some cases. Without both, an organisation is forced into either identical, box-ticking documents or a separate template for every path.

### Template Validation
Uploaded `.docx` templates are validated at upload time; files with malformed tags or invalid type annotations are rejected immediately with a clear error message rather than failing silently during a live session.

_Why it matters:_ The person uploading the template is not a developer and won't be watching when it runs. Failing at upload — with a readable message — keeps an authoring mistake away from the end user mid-session.

### Manual Document Field Editing
After a document is generated, an operator can open a typed edit form and correct individual field values. Saving re-renders the DOCX to a new version, updates the step output the rest of the flow reads from, and appends the change to a durable, auditable edit history without re-running AI grading.

_Why it matters:_ AI extraction is not infallible, and re-running an entire conversation to fix one wrong value is wasteful. Direct, audited field correction lets the operator stay accountable for the document without fighting the tool.

### Context Document Extraction
PDF, DOCX, and XLSX files uploaded as flow-level context documents are parsed and their content is injected into the AI's background knowledge for every session on that flow. This allows flows to be grounded in reference material such as policies, contracts, or product specifications.

_Why it matters:_ The organisation's policies and standards are what make its documents correct, and no model has seen them. Injecting them per flow means the generated document reflects the organisation, not a generic template.

### Configurable Document Generation Budgets
The safety limits that bound document generation — context-document token budget, field batch size, and max prompt tokens — are admin-configurable from **Configuration → AI → Document Generation** instead of hardcoded, and apply on the next request with no redeploy. The context budget can be set as an explicit token cap or as a percentage of the configured model's context window.

_Why it matters:_ The right generation limits depend on the model in use and the size of an organisation's documents. Making them configuration rather than code lets admins tune for their own templates without a release.

---

## Governance & Sign-Off

The staged human control that distinguishes a governed workflow from a chat window.

### Approval Workflow Node
A flow can include an `approval` node that pauses a session until a confirmed human approver decides to approve, reject, or request changes. A suggested approver is proposed automatically (by reporting line, role, or policy) but the operator always confirms or overrides the choice through a federated people search before the request is sent.

_Why it matters:_ Some processes legally or organisationally require a human sign-off. A first-class approval node brings that gate inside the flow — where it is enforced and recorded — instead of leaving it as an email someone is trusted to send.

### Federated Approver Resolution
Approver suggestions are resolved across multiple sources — Microsoft Entra directory data, an uploaded HR spreadsheet (with AI-assisted column mapping), or a retrieval-augmented lookup over the flow's own reference material — with a free-typed email always available as a fallback.

_Why it matters:_ The end user often doesn't know who is supposed to approve their request, and no single directory has the whole answer. Federating the sources turns "who signs this off?" from a question the user has to research into one the system proposes.

### Approval Context & Decision UX
The `/approvals` inbox shows the approver exactly what they're deciding on — the requesting chat, who it's from, and the actual output (document or field table) from the step being approved. Approve, reject, and request-changes decisions are captured through a comment modal, are written back into the chat as a system message, and a "request changes" decision automatically routes the session back to the prior step for the user to address.

_Why it matters:_ Approving something without seeing what it's approving isn't a real review. Full context plus an automatic route back on "request changes" makes the gate meaningful — the correction happens inside the flow, not in a side conversation.

### Cost & Usage Governance
Admins can set per-user spend caps (daily, weekly, or monthly USD limits, off by default) with a configurable warn threshold; once a cap is reached, further AI calls are blocked with a clear in-chat message rather than failing silently, and every warn or block is audited. A governance dashboard shows total spend, spend by user and by flow, and each cap's current utilisation; cap management is also available from the existing Usage screen.

_Why it matters:_ Putting AI in the hands of every business user only works if spend has a hard backstop. Per-user caps with a warning stage let an organisation open the tool up widely without an open-ended bill — and the user gets a plain message rather than a broken session.

---

## Grounding the AI in Your Own Knowledge

An AI that guides a regulated process has to answer from the organisation's material, not from training data.

### RAG with pgvector
Documents uploaded to the knowledge base are chunked, embedded, and stored in PostgreSQL using the pgvector extension. During a session the AI performs semantic similarity search over the embedded chunks to retrieve the most relevant passages and inject them into the prompt.

_Why it matters:_ Context document extraction works well for small, focused reference files. For large corpora — product manuals, legal libraries, regulatory archives — full-text injection exceeds the model's context window. RAG retrieves only what's relevant, keeping answers grounded and costs manageable.

### Knowledge Base Curation
Subject-matter experts get a dedicated curation grid to search, edit, tag, and bulk archive or restore knowledge base chunks, with full version history and one-click revert. Any user can flag an AI answer with "Fix This Answer" and submit a correction; SMEs triage submitted corrections from the same screen. Edited chunks are automatically re-embedded, and retrieval combines Postgres full-text search with pgvector similarity for more reliable matches.

_Why it matters:_ RAG is only as good as the content it retrieves, and bad chunks are invisible from the chat alone. A governed correction loop — anyone can flag, an SME decides — is how an organisation keeps ownership of what the AI tells its people, without a developer in the path.

### Configurable Embeddings
The embedding model, provider, and vector dimensions are configurable per deployment via environment variables. A reindex-all command re-embeds every document in the knowledge base, making it straightforward to migrate to a better embedding model without losing existing content.

_Why it matters:_ Embedding models improve rapidly and the right model differs by domain. Treating the embedding provider as a configuration concern rather than a code constant lets organisations upgrade without a code change.

### View Knowledge from Flow Editor
A "View knowledge" button in the flow editor's context-documents panel opens the curation grid pre-filtered to that flow's knowledge base.

_Why it matters:_ A flow owner shouldn't have to navigate away and re-select their flow to check what the AI actually knows. A direct link keeps authoring and knowledge review in the same workflow.

---

## Designing a Flow Without Code

The authoring side of the same promise: the person who owns the process configures it, and no developer is needed to change it.

### Visual Canvas Builder
Admins design workflows on a drag-and-drop node canvas powered by React Flow. Each node represents a step in the process; edges define the order and branching paths. Nodes are configured with AI instructions, completion criteria, colour, and output type. The canvas persists all changes to the database so a flow can be built incrementally across sessions.

_Why it matters:_ The people who know the process — procurement officers, HR managers, ops leads — are not developers. A visual canvas is what puts flow authorship in their hands rather than in a backlog, and incremental persistence means a complex process can be modelled over days, not in one sitting.

### Step Prompt Preview
Before publishing, a flow owner can preview the exact AI prompt that will be generated for each step, including injected context. This lets authors verify the prompt reads as intended and catches configuration mistakes before users encounter them.

_Why it matters:_ "No prompt engineering" only holds if the author can still see what the AI was told. The preview closes the feedback loop for a non-technical author — they check the rendered result instead of reasoning about prompt assembly.

### Flow Versioning
Publishing a flow snapshots it as an immutable, numbered version. Sessions are pinned to the version that was live when they started, so editing or restoring a flow never changes an in-progress chat. Admins can inspect the full version history and non-destructively restore an earlier version, which itself publishes as a new version.

_Why it matters:_ A governed process must be able to answer "which version of the process was this document produced under?". Pinning sessions to an immutable version answers that, and makes editing a live flow safe rather than risky.

### Flow Visibility Control
Flows can be set to **private** (accessible only to the flow owner) or **global** (accessible to all authenticated users). Admins control this from the flow listing page. Users only see published, globally-visible flows in the New Chat modal.

_Why it matters:_ Organisations need to test and iterate on flows before rolling them out. Private visibility lets a flow owner iterate without exposing a half-finished process to the people who will have to follow it.

---

## Steps That Run Without a Human

### n8n Automation Integration
Flow steps can be configured as "auto-nodes" that trigger an n8n workflow instead of prompting a human. Session context is serialised as structured JSON and posted to n8n; the flow pauses and resumes automatically when n8n calls back with its result.

_Why it matters:_ Not every step in a process needs a person — a lookup, a record creation, a notification. Auto-nodes keep those steps inside the governed flow instead of pushing the user out to another system mid-process.

### n8n Workflow Context Mapping
Outputs returned by an n8n workflow are mapped back into the session context using a configurable field mapping. Downstream steps can reference the n8n output fields as if they had been gathered through conversation.

_Why it matters:_ Without context mapping, n8n outputs are opaque to the AI. Explicit field mapping makes automation outputs first-class session data, so later steps — and the generated document — can use them like anything else the session gathered.

### Scheduled Sessions
Flows can be configured to start sessions automatically on a cron schedule or fixed interval. Scheduled sessions run unattended via the background worker and proceed through all auto-nodes without human input.

_Why it matters:_ Many compliance and reporting processes must run at specific times — end of day, end of month, on a trigger date. Scheduling means the process runs because it was designed to, not because someone remembered.

### Plain-Language Schedule UX
Schedule recurrence is configured using a plain-language input (e.g. "every weekday at 9 AM", "first Monday of the month") rather than raw cron syntax. The UI shows a human-readable confirmation of the next scheduled run time.

_Why it matters:_ Cron syntax is exactly the kind of technical gate Wayfinder is meant to remove. A plain-language input keeps scheduling with the business owner and makes a misconfiguration visible before it fires.

### Microsoft 365 Email Provider
Admins can configure Microsoft 365/Exchange as the outbound email provider for notifications, alongside SMTP, and control which events (session complete, flow shared) trigger an email.

_Why it matters:_ Many organisations already run Microsoft 365 and would rather use it directly than stand up a separate SMTP relay for one application.

---

## Seeing Whether It's Working

### Overview Dashboard
An admin dashboard shows organisation-wide session metrics: active sessions, total completions, completion rate, period-on-period deltas, a daily started-vs-completed dual-line chart, flow distribution by session count, and an AI confidence trend across session lifetime.

_Why it matters:_ A guided process is only worth having if people finish it. Aggregate completion and confidence trends are how an admin finds out whether the flows they published are actually working.

### Flow Usage & Insights Dashboards
A per-flow analytics view is split across two pages: **Flow usage** shows step-by-step drop-off rates, average AI confidence per step, and a node breakdown table with completion colour coding, while **Insights** hosts template field reporting, aggregating the values actually inserted into generated documents. Same-meaning columns from mutually-exclusive branches or across flow versions are automatically consolidated (togglable) so the report reads as one field, not several duplicates.

_Why it matters:_ The overview tells you something is wrong; flow usage and insights tell you where and why. Step-level drop-off identifies which nodes cause users to abandon, field-level reporting lets compliance officers verify that documents contain the expected data, and consolidation stops a flow's evolution from fragmenting that report into noise.

### Langfuse Integration
Langfuse tracing is available as an opt-in integration. When configured, every LLM call — text stream, object generation, branch choice — produces a trace in Langfuse with latency, token counts, model ID, and the full prompt/response payload.

_Why it matters:_ LLM costs and latency are opaque without instrumentation. Langfuse traces make it possible to optimise prompts, identify slow steps, and attribute token spend to specific flows and steps.

---

## Fitting the Organisation

Identity, roles, and accessibility — the conditions an organisation attaches before a tool reaches its people.

### Microsoft Entra ID Login
Admins can enable Microsoft Entra ID as a sign-in method alongside email and password, entering the app-registration credentials directly in the admin UI with changes taking effect immediately, no redeploy required. The "Sign in with Microsoft" button only appears once Entra is fully configured, and first-time Entra sign-in auto-provisions a non-admin account (linking to an existing user by verified email where one exists).

_Why it matters:_ Rolling a process out to a whole department means people sign in with the account they already have. Configuring SSO at runtime, rather than through environment variables and a deploy, keeps identity setup with the admin who owns it.

### Custom Roles & Feature Access
Admins can create custom roles beyond the built-in set, rename non-immutable roles, and control access to individual features through a feature-access matrix on the Roles page, rather than every permission being hardcoded to a fixed role.

_Why it matters:_ Organisations don't all draw admin boundaries the same way — flow authoring, knowledge curation, and approvals often sit with different teams. Custom roles let each of those be delegated precisely, without over- or under-provisioning access.

### On-Demand Connectivity Testing
Each external integration configured on the admin Settings page (AI provider, object storage, email, n8n, embeddings, Entra) gets a "Test connectivity" button that runs a live, read-only probe against the saved credentials, plus a "Test all" button that runs every applicable probe in parallel.

_Why it matters:_ A saved API key or connection string isn't proof it works. On-demand testing gives an admin immediate confidence that an integration is actually reachable, rather than discovering it mid-session in front of a user.

### WCAG 2.2 AA Compliance
The web app is built and continuously checked against WCAG 2.2 AA — colour contrast, keyboard navigation, focus management, and labelling are enforced as part of `validate.sh` and covered by a dedicated Playwright accessibility suite, not left to manual spot-checks.

_Why it matters:_ A tool meant for every operator in an organisation has to work for every operator, including those using assistive technology — and many organisations require WCAG AA as a procurement condition. Enforcing it continuously keeps regressions from shipping unnoticed.

### Multi-Provider AI
The AI provider, model ID, and API key are all configurable via environment variables. Supported providers are Anthropic, OpenAI, Mistral, and AWS Bedrock. Different steps in a flow can use different models; the embedding provider is configured independently of the chat provider.

_Why it matters:_ AI model choice is a commercial, regulatory, and performance decision that varies by organisation and jurisdiction. Treating the provider as configuration rather than a hard dependency means Wayfinder can operate in AWS GovCloud, European data-residency environments, or wherever the organisation's AI procurement has landed.
