/**
 * Shared skip messages.
 *
 * The run summary groups skips by their exact reason text, so wording is not
 * cosmetic — it decides what the report can show you. Eleven spellings of "the
 * composer isn't there" (`Chat input not found`, `Chat input not visible`,
 * `Chat input not found — skipping multi-turn test`, `No active session with a
 * usable composer found`, …) scattered the single largest cluster in the suite
 * across eleven rows of a 56-row table, where it read as a long tail of
 * unrelated problems instead of one control failing one way.
 *
 * Add a constant here rather than a new phrasing whenever a guard is asking a
 * question another guard already asks.
 */

/**
 * The composer textarea is absent. Every guard using this currently probes with
 * `isVisible()`, which does not wait — so "had not rendered" is a real
 * possibility and the message says so rather than blaming the session.
 */
export const NO_COMPOSER =
  "No chat composer — the session is complete, read-only, or had not rendered yet";

/**
 * The composer is there but its attach control is not. Distinct from
 * `NO_COMPOSER`: a read-only session drops the attach button while still
 * rendering the thread, so collapsing these two would hide which one failed.
 */
export const NO_ATTACH_CONTROL =
  "No attach control on the composer — the session is read-only, or it had not rendered yet";
