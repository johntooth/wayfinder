// Pure decision for whether the run screen should drive the batch engine.
//
// A run only advances when something ticks it. The background poller in
// `apps/api` does that, but it may be disabled or on a slower cadence than an
// operator watching the screen, so the run screen ticks the run itself while it
// is live. The rules that keep that from becoming a hot loop:
//
// - only a `running` run is claimable — every other status is a stop the
//   operator resumes from, or terminal
// - never overlap a tick already in flight
// - stop after a failed tick; the background worker keeps retrying

export interface RunTickState {
  status: string | undefined;
  tickInFlight: boolean;
  tickBlocked: boolean;
}

export const shouldDriveTick = ({ status, tickInFlight, tickBlocked }: RunTickState): boolean =>
  status === "running" && !tickInFlight && !tickBlocked;

const LIVE_STATUSES = new Set(["running", "paused_preview", "paused_cap"]);

// Whether the run can still change under the operator, which is what every panel
// on the run screen polls on. A paused run counts: it resumes without a reload,
// and the screen has to notice when it does.
export const isLiveRun = (status: string | undefined): boolean =>
  status !== undefined && LIVE_STATUSES.has(status);

// Whether the run is doing work right now, which is what the spinner reflects.
export const isProcessing = (status: string | undefined): boolean => status === "running";

// The progress bar animates only while work is actually happening. A perpetually
// moving bar would read as decoration; a still bar on a paused or finished run is
// an accurate signal that nothing is advancing.
export const shouldAnimateProgress = (status: string | undefined): boolean => isProcessing(status);
