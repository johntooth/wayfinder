"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  BarChart2,
  BookOpen,
  ChevronDown,
  Clock,
  FlaskConical,
  Flag,
  GitBranch,
  LogOut,
  Menu,
  MessageSquare,
  PieChart,
  Plug,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Stamp,
  Users,
  UsersRound,
  Building2,
  X,
} from "lucide-react";
import { HelpMenu } from "@/components/help-menu";
import { NewChatModal } from "@/components/chat/new-chat-modal";
import { useSidebar } from "@/components/sidebar-context";
import { formatRecentChatMeta, isNewChatShortcut } from "@/components/sidebar-model";
import { UsageMeter, UsageRing } from "@/components/usage-meter";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/trpc/client";

interface NavItem {
  href: string;
  icon: React.ElementType;
  label: string;
  // Count of items awaiting the user on that surface. Rendered as a pill on the
  // right of the link; omitted or zero renders nothing.
  badgeCount?: number;
}

interface NavGroup {
  label?: string;
  items: NavItem[];
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

// Synthesise Information sits directly under Approvals when the extraction_flows
// flag resolves (ADR-033 §7) — inline in the main group, no separate rule.
const buildUserNav = (extractionEnabled: boolean, pendingApprovals: number): NavGroup[] => [
  {
    items: [
      { href: "/chats", icon: MessageSquare, label: "My Chats" },
      { href: "/flows", icon: GitBranch, label: "Flows" },
      { href: "/approvals", icon: Stamp, label: "Approvals", badgeCount: pendingApprovals },
      ...(extractionEnabled
        ? [{ href: "/synthesise", icon: FlaskConical, label: "Synthesise Information" }]
        : []),
    ],
  },
];

interface AdminNavContext {
  readonly skillsEnabled: boolean;
  readonly mcpEnabled: boolean;
  readonly canCurate: boolean;
  readonly organisationsEnabled: boolean;
  readonly extractionEnabled: boolean;
}

const buildAdminNav = ({
  skillsEnabled,
  mcpEnabled,
  canCurate,
  organisationsEnabled,
  extractionEnabled,
}: AdminNavContext): NavGroup[] => {
  // Skills + MCP Servers are hidden when their feature flag is disabled — an
  // admin who turned the flag off should not see the surface it controls.
  // Admins can still re-enable via /admin/flags in the Advanced group.
  const flowSettingsItems: NavItem[] = [];
  if (skillsEnabled) flowSettingsItems.push({ href: "/admin/skills", icon: Sparkles, label: "Skills" });
  if (mcpEnabled) flowSettingsItems.push({ href: "/admin/mcp-servers", icon: Plug, label: "MCP Servers" });
  // Knowledge lives only in Flow Settings; the page still enforces
  // knowledge:curate regardless (ADR-021).
  if (canCurate) flowSettingsItems.push({ href: "/knowledge", icon: BookOpen, label: "Knowledge" });

  const groups: NavGroup[] = [
    {
      items: [
        { href: "/admin/dashboards/overview", icon: Activity, label: "Overview" },
        { href: "/admin/dashboards/insights", icon: PieChart, label: "Flow Insights" },
        { href: "/admin/dashboards/flows", icon: BarChart2, label: "Flow Usage" },
        { href: "/admin/sessions", icon: MessageSquare, label: "All Chats" },
        { href: "/admin/flows", icon: GitBranch, label: "All Flows" },
        // Shown only when the extraction_flows flag resolves (ADR-033 §7).
        ...(extractionEnabled
          ? [{ href: "/admin/synthesise", icon: FlaskConical, label: "Synthesise Information" }]
          : []),
        { href: "/admin/settings", icon: Settings, label: "Configuration" },
      ],
    },
    {
      label: "Users and Roles",
      collapsible: true,
      defaultCollapsed: true,
      items: [
        { href: "/admin/users", icon: Users, label: "Users" },
        { href: "/admin/roles", icon: ShieldCheck, label: "Roles" },
        { href: "/admin/groups", icon: UsersRound, label: "Groups" },
        // Organisations are hidden while the feature is switched off (ADR-038).
        ...(organisationsEnabled
          ? [{ href: "/admin/organisations", icon: Building2, label: "Organisations" }]
          : []),
      ],
    },
    {
      label: "Advanced Flow Settings",
      collapsible: true,
      defaultCollapsed: true,
      items: flowSettingsItems,
    },
    {
      label: "Advanced",
      collapsible: true,
      defaultCollapsed: true,
      items: [
        { href: "/admin/usage", icon: BarChart2, label: "Usage" },
        { href: "/admin/flags", icon: Flag, label: "Flags" },
        { href: "/admin/errors", icon: AlertCircle, label: "Errors" },
        { href: "/admin/audit", icon: ScrollText, label: "Audit" },
        { href: "/admin/schedules", icon: Clock, label: "Schedules" },
      ],
    },
  ];
  // Advanced Flow Settings can be empty when Skills/MCP/Knowledge are all
  // unavailable — drop empty groups so no lonely collapsible header shows.
  return groups.filter((group) => group.items.length > 0);
};

interface AppSidebarProps {
  isAdmin?: boolean;
}

// The user rail carries four items and uses the design system's 6px dot. The
// admin rail carries around twenty across four groups, where twenty identical
// dots stop being scannable — so it keeps per-item icons.
type NavMark = "dot" | "icon";

const SECTION_LABEL_CLASS =
  "px-[10px] pb-[6px] pt-[8px] font-mono text-[10px] uppercase tracking-[0.1em] text-[#736d5f]";

function NavGroups({
  groups,
  mark,
  isActive,
  onNavigate,
}: {
  groups: NavGroup[];
  mark: NavMark;
  isActive: (href: string) => boolean;
  onNavigate: () => void;
}) {
  // A collapsible group auto-expands when it holds the active route so the
  // current page is never hidden behind a collapsed header.
  const groupHoldsActive = (group: NavGroup): boolean => group.items.some((item) => isActive(item.href));

  // Tracks only groups the user has explicitly toggled. Groups appear
  // asynchronously (Skills/MCP/Knowledge depend on feature-flag queries that
  // resolve after mount), so we never seed this from the initial `groups` — an
  // untouched group falls back to its `defaultCollapsed` at render time instead,
  // which keeps "Advanced Flow Settings" collapsed even though it loads late.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const isGroupCollapsed = (group: NavGroup): boolean =>
    overrides[group.label as string] ?? group.defaultCollapsed ?? false;

  return (
    <>
      {groups.map((group, index) => {
        const isCollapsible = Boolean(group.collapsible && group.label);
        const isCollapsed = isCollapsible && isGroupCollapsed(group) && !groupHoldsActive(group);

        return (
          <div key={group.label ?? `group-${index}`} className={index > 0 ? "mt-[6px]" : undefined}>
            {group.label &&
              (isCollapsible ? (
                <button
                  type="button"
                  onClick={() =>
                    setOverrides((prev) => ({ ...prev, [group.label as string]: !isGroupCollapsed(group) }))
                  }
                  className={`flex w-full items-center justify-between transition-colors hover:text-[#5c574c] ${SECTION_LABEL_CLASS}`}
                >
                  {group.label}
                  <ChevronDown
                    className={`h-[13px] w-[13px] shrink-0 transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                  />
                </button>
              ) : (
                <div className={SECTION_LABEL_CLASS}>{group.label}</div>
              ))}

            {!isCollapsed &&
              group.items.map(({ href, icon: Icon, label, badgeCount }) => {
                const active = isActive(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={onNavigate}
                    className={`flex items-center gap-[10px] rounded-[8px] px-[10px] py-[6.5px] text-[13px] transition-colors ${
                      active
                        ? "bg-[#ebe8e0] font-semibold text-[#1c1b19]"
                        : "text-[#5c574c] hover:bg-[#efece5] hover:text-[#1c1b19]"
                    }`}
                  >
                    {mark === "dot" ? (
                      <span
                        aria-hidden="true"
                        className={`h-[6px] w-[6px] shrink-0 rounded-full ${
                          active ? "bg-[#2f56d3]" : "bg-[#c9c3b5]"
                        }`}
                      />
                    ) : (
                      <span className="flex h-[16px] w-[16px] shrink-0 items-center justify-center">
                        <Icon className="h-[14px] w-[14px]" />
                      </span>
                    )}
                    <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
                    {badgeCount !== undefined && badgeCount > 0 && (
                      <span
                        aria-label={`${badgeCount} awaiting your action`}
                        className="shrink-0 text-[11px] font-semibold text-[#736d5f]"
                      >
                        {badgeCount > 99 ? "99+" : badgeCount}
                      </span>
                    )}
                  </Link>
                );
              })}
          </div>
        );
      })}
    </>
  );
}

export function AppSidebar({ isAdmin = false }: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { mobileOpen, openMobile, closeMobile } = useSidebar();
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  const userQuery = trpc.user.me.useQuery();
  const sessionsQuery = trpc.session.list.useQuery(undefined, {
    enabled: !isAdmin,
  });
  const publishedFlowsQuery = trpc.session.listPublishedFlows.useQuery(undefined, {
    enabled: !isAdmin,
  });
  // Drives the Approvals badge. Shares its cache entry with /approvals, so
  // deciding an approval there refreshes the count here without another fetch.
  const pendingApprovalsQuery = trpc.approval.listPending.useQuery(undefined, {
    enabled: !isAdmin,
  });

  const handleSignOut = async (): Promise<void> => {
    await authClient.signOut();
    window.location.href = "/login";
  };

  // The ⌘K hint beside New chat is bound to a real handler; a decorative
  // shortcut pill would be a lie to the user.
  useEffect(() => {
    if (isAdmin) return;
    const handler = (event: KeyboardEvent) => {
      const shouldOpen = isNewChatShortcut({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        target: event.target as { tagName?: string; isContentEditable?: boolean } | null,
      });
      if (!shouldOpen) return;
      event.preventDefault();
      closeMobile();
      setNewChatOpen(true);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [closeMobile, isAdmin]);

  useEffect(() => {
    if (!accountOpen) return;
    const handler = (event: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [accountOpen]);

  // Knowledge lives in the admin menu only; the page and its tRPC procedures
  // still enforce knowledge:curate regardless (ADR-021).
  const canCurate =
    (userQuery.data?.isAdmin ?? false) ||
    (userQuery.data?.permissions ?? []).includes("knowledge:curate");
  const skillsFlagQuery = trpc.featureFlag.isEnabledForMe.useQuery(
    { key: "skills" },
    { enabled: isAdmin },
  );
  const mcpFlagQuery = trpc.featureFlag.isEnabledForMe.useQuery(
    { key: "mcp" },
    { enabled: isAdmin },
  );
  const organisationsEnabledQuery = trpc.organisation.isEnabled.useQuery(undefined, {
    enabled: isAdmin,
  });
  // Gates the "Synthesise Information" surface on both the user and admin menus.
  const extractionFlagQuery = trpc.featureFlag.isEnabledForMe.useQuery({
    key: "extraction_flows",
  });
  const extractionEnabled = extractionFlagQuery.data ?? false;
  const adminNav = buildAdminNav({
    skillsEnabled: skillsFlagQuery.data ?? false,
    mcpEnabled: mcpFlagQuery.data ?? false,
    canCurate,
    organisationsEnabled: organisationsEnabledQuery.data ?? false,
    extractionEnabled,
  });
  const nav: NavGroup[] = isAdmin
    ? adminNav
    : buildUserNav(extractionEnabled, pendingApprovalsQuery.data?.length ?? 0);
  const homeHref = isAdmin ? "/admin/flows" : "/chats";

  const recentChats = isAdmin
    ? []
    : (sessionsQuery.data ?? [])
        .filter((session) => session.status !== "abandoned")
        .slice(0, 8)
        .map((session) => {
          const flow = publishedFlowsQuery.data?.find((f) => f.id === session.flowId);
          return {
            id: session.id,
            label: session.title ?? flow?.name ?? "Untitled chat",
            meta: formatRecentChatMeta(session.status, session.updatedAt),
          };
        });

  const user = userQuery.data;
  const displayName = user?.name ?? user?.email ?? "";
  const initials = displayName
    .split(" ")
    .map((n: string) => n[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase() || (user?.email?.slice(0, 2).toUpperCase() ?? "?");

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  const brand = (trailing?: React.ReactNode) => (
    <div className="flex items-center gap-[9px] px-[6px]">
      <Link href={homeHref} onClick={closeMobile} aria-label="Wayfinder home">
        <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] bg-[#2f56d3] text-[13px] font-bold text-white">
          W
        </div>
      </Link>
      <span className="text-[15px] font-semibold tracking-[-0.01em] text-[#1c1b19]">Wayfinder</span>
      <span className="rounded-[4px] border border-[#dedad2] px-[5px] py-[2px] font-mono text-[9px] uppercase tracking-[0.1em] text-[#736d5f]">
        {isAdmin ? "Admin" : "Alpha"}
      </span>
      {trailing ?? <HelpMenu className="ml-auto" />}
    </div>
  );

  const newChatButton = !isAdmin && (
    <button
      type="button"
      onClick={() => {
        closeMobile();
        setNewChatOpen(true);
      }}
      className="flex items-center gap-[8px] rounded-[9px] border border-[#dedad2] bg-white px-[12px] py-[8px] text-[13px] font-medium text-[#1c1b19] shadow-[0_1px_2px_rgba(28,27,25,0.04)] transition-colors hover:border-[#c3cef2] hover:bg-[#eaeefb]"
    >
      <span aria-hidden="true" className="text-[15px] leading-none text-[#2f56d3]">
        +
      </span>
      New chat
      <kbd className="ml-auto rounded-[4px] border border-[#e7e3db] bg-[#f5f3ee] px-[4px] py-[1px] font-mono text-[10px] font-normal text-[#736d5f]">
        ⌘K
      </kbd>
    </button>
  );

  const recentChatsBlock = recentChats.length > 0 && (
    <div className="flex flex-col gap-[3px]">
      <div className={SECTION_LABEL_CLASS}>Recent</div>
      {recentChats.map((chat) => {
        const active = isActive(`/chats/${chat.id}`);
        return (
          <Link
            key={chat.id}
            href={`/chats/${chat.id}`}
            onClick={closeMobile}
            className={`flex flex-col gap-[3px] rounded-[8px] px-[10px] py-[7.5px] transition-colors ${
              active
                ? "border border-[#e7e3db] bg-white"
                : "border border-transparent hover:bg-[#efece5]"
            }`}
          >
            <span
              className={`overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] leading-[1.3] ${
                active ? "font-medium text-[#1c1b19]" : "text-[#5c574c]"
              }`}
            >
              {chat.label}
            </span>
            <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[10.5px] text-[#736d5f]">
              {chat.meta}
            </span>
          </Link>
        );
      })}
    </div>
  );

  const footer = (
    <div className="mt-auto flex flex-col gap-[8px] px-[4px] pb-[4px] pt-[10px]">
      {isAdmin && (
        <button
          onClick={() => {
            closeMobile();
            router.push("/chats");
          }}
          className="rounded-[7px] border border-dashed border-[#d8d3c7] px-[9px] py-[5px] text-center text-[11.5px] text-[#5c574c] transition-colors hover:bg-[#efece5] hover:text-[#1c1b19]"
        >
          Exit admin mode
        </button>
      )}
      {!isAdmin && user?.isAdmin && (
        <button
          onClick={() => {
            closeMobile();
            router.push("/admin/sessions");
          }}
          className="rounded-[7px] border border-dashed border-[#d8d3c7] px-[9px] py-[5px] text-center text-[11.5px] text-[#5c574c] transition-colors hover:bg-[#efece5] hover:text-[#1c1b19]"
        >
          Enter admin mode
        </button>
      )}

      {user && (
        <div ref={accountRef} className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={accountOpen}
            aria-label="Account menu"
            onClick={() => setAccountOpen((previous) => !previous)}
            className="flex w-full items-center gap-[9px] rounded-[8px] px-[4px] py-[6px] text-left transition-colors hover:bg-[#efece5]"
          >
            <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-[#dedad2] text-[12px] font-semibold text-[#5c574c]">
              {initials}
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[12.5px] font-medium text-[#1c1b19]">{displayName}</span>
              {user.email && (
                <span className="truncate text-[10.5px] text-[#736d5f]">{user.email}</span>
              )}
            </div>
            <UsageRing />
          </button>

          {accountOpen && (
            <div
              role="menu"
              className="absolute bottom-full left-0 right-0 z-30 mb-[6px] overflow-hidden rounded-[9px] border border-[#e7e3db] bg-white py-[4px] shadow-wf-md"
            >
              <Link
                role="menuitem"
                href="/settings"
                onClick={() => {
                  setAccountOpen(false);
                  closeMobile();
                }}
                className="flex items-center gap-[8px] px-[12px] py-[7px] text-[13px] text-[#1c1b19] hover:bg-[#efece5]"
              >
                <Settings className="h-[14px] w-[14px] shrink-0 text-[#5c574c]" />
                Settings
              </Link>
              <div className="border-t border-[#e7e3db]">
                <UsageMeter />
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAccountOpen(false);
                  closeMobile();
                  void handleSignOut();
                }}
                className="flex w-full items-center gap-[8px] border-t border-[#e7e3db] px-[12px] py-[7px] text-left text-[13px] text-[#1c1b19] hover:bg-[#efece5]"
              >
                <LogOut className="h-[14px] w-[14px] shrink-0 text-[#5c574c]" />
                Sign out
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const railBody = (
    <>
      {newChatButton}
      <nav className="flex flex-col gap-[2px]">
        <NavGroups
          groups={nav}
          mark={isAdmin ? "icon" : "dot"}
          isActive={isActive}
          onNavigate={closeMobile}
        />
      </nav>
      {recentChatsBlock}
    </>
  );

  return (
    <>
      {/* Desktop rail — tinted surface, single hairline, no panel shadow. */}
      <aside
        data-testid="app-sidebar"
        className="hidden w-[246px] shrink-0 flex-col gap-[18px] overflow-y-auto border-r border-[#e7e3db] bg-[#f5f3ee] px-[14px] py-[18px] sm:flex"
      >
        {brand()}
        {railBody}
        {footer}
      </aside>

      {/* Mobile: hamburger triggers the drawer managed by parent context */}
      {mobileOpen && (
        <>
          {/* Backdrop — a button so it is keyboard-focusable and dismissable */}
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 bg-[rgba(28,27,25,0.32)]"
            onClick={closeMobile}
          />
          {/* Drawer */}
          <div
            data-testid="app-sidebar-drawer"
            className="fixed bottom-0 left-0 top-0 z-50 flex w-[246px] flex-col gap-[18px] overflow-y-auto bg-[#f5f3ee] px-[14px] py-[18px] shadow-[4px_0_20px_rgba(28,27,25,.12)]"
          >
            {brand(
              <button
                onClick={closeMobile}
                aria-label="Close menu"
                className="ml-auto flex h-[26px] w-[26px] items-center justify-center rounded-[6px] border border-[#dedad2] text-[#736d5f] hover:bg-[#efece5]"
              >
                <X className="h-3.5 w-3.5" />
              </button>,
            )}
            {railBody}
            {footer}
          </div>
        </>
      )}

      {/* Mobile hamburger trigger — rendered inside the layout's content column via the mobile header */}
      <button
        className="fixed left-4 top-[14px] z-30 flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#e7e3db] bg-white shadow-[0_1px_2px_rgba(28,27,25,.06)] sm:hidden"
        onClick={openMobile}
        aria-label="Open navigation"
      >
        <Menu className="h-4 w-4 text-[#5c574c]" />
      </button>

      {!isAdmin && (
        <NewChatModal
          open={newChatOpen}
          onClose={() => setNewChatOpen(false)}
          publishedFlows={publishedFlowsQuery.data ?? []}
        />
      )}
    </>
  );
}
