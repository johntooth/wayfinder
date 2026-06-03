import {
  ok,
  type IFlowNodeRepository,
  type IScheduleFireHandler,
  type ISessionMessageRepository,
  type Result,
  type SessionSchedule,
} from "@rbrasier/domain";

// A minimal concrete fire effect: when a schedule fires, post a system message
// into the session announcing the scheduled step. This makes firing observable
// and lets the scheduler run end-to-end. Full session auto-advance (re-driving
// the flow graph past the scheduled node) is intentionally out of scope here and
// remains follow-up work.
export class NotifyScheduleFireHandler implements IScheduleFireHandler {
  constructor(
    private readonly sessionMessages: ISessionMessageRepository,
    private readonly flowNodes: IFlowNodeRepository,
  ) {}

  async fire(schedule: SessionSchedule): Promise<Result<void>> {
    const stepName = await this.resolveStepName(schedule.nodeId);
    const occurrence = schedule.occurrenceCount + 1;

    const created = await this.sessionMessages.create({
      sessionId: schedule.sessionId,
      role: "system",
      content: `Scheduled step fired: ${stepName} (occurrence ${occurrence}).`,
      stepNodeId: schedule.nodeId,
    });
    if (created.error) return created;
    return ok(undefined);
  }

  // Best-effort: a missing or unreadable node must not block the fire.
  private async resolveStepName(nodeId: string): Promise<string> {
    const node = await this.flowNodes.findById(nodeId);
    if (node.error || !node.data) return "scheduled step";
    return node.data.name;
  }
}
