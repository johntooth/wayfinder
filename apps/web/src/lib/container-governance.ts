import {
  CreateBudget,
  DeleteBudget,
  GetFlowDeepDive,
  GetGovernanceDashboard,
  GetOverviewDashboard,
  GetUsageLimitsEnabled,
  GetUserUsage,
  ListBudgets,
  SetUsageLimitsEnabled,
  UpdateBudget,
} from "@rbrasier/application";
import type {
  IAnalyticsRepository,
  IBudgetRepository,
  IFlowEdgeRepository,
  IFlowNodeRepository,
  IFlowRepository,
  ISessionStepOutputRepository,
  ISystemSettingsRepository,
  IUsageRepository,
  IUserRepository,
  IUserRoleRepository,
} from "@rbrasier/domain";

export interface GovernanceModuleDeps {
  analytics: IAnalyticsRepository;
  usage: IUsageRepository;
  budgets: IBudgetRepository;
  users: IUserRepository;
  userRoles: IUserRoleRepository;
  flows: IFlowRepository;
  flowNodes: IFlowNodeRepository;
  flowEdges: IFlowEdgeRepository;
  sessionStepOutputs: ISessionStepOutputRepository;
  systemSettings: ISystemSettingsRepository;
}

// The governance, budget and analytics use cases as one wiring unit, mirroring
// `buildExtractionModule` — they share a repository set and nothing outside this
// group depends on how they are constructed.
export const buildGovernanceModule = (deps: GovernanceModuleDeps) => ({
  getOverviewDashboard: new GetOverviewDashboard(deps.analytics),
  getGovernanceDashboard: new GetGovernanceDashboard(deps.usage, deps.budgets, deps.users, deps.flows),
  createBudget: new CreateBudget(deps.budgets),
  updateBudget: new UpdateBudget(deps.budgets),
  deleteBudget: new DeleteBudget(deps.budgets),
  listBudgets: new ListBudgets(deps.budgets),
  getUserUsage: new GetUserUsage(deps.systemSettings, deps.budgets, deps.userRoles, deps.usage),
  getUsageLimitsEnabled: new GetUsageLimitsEnabled(deps.systemSettings),
  setUsageLimitsEnabled: new SetUsageLimitsEnabled(deps.systemSettings),
  getFlowDeepDive: new GetFlowDeepDive(
    deps.flows,
    deps.flowNodes,
    deps.analytics,
    deps.sessionStepOutputs,
    deps.flowEdges,
  ),
});
