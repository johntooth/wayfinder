import type { ReactNode } from "react";
import { AppSidebar } from "@/components/sidebar";
import { SidebarProvider } from "@/components/sidebar-context";
import { createServerHelpers } from "@/trpc/server";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { trpc, HydrateClient } = await createServerHelpers();

  void trpc.user.me.prefetch();
  void trpc.flow.list.prefetch();
  void trpc.user.list.prefetch({});

  return (
    <SidebarProvider>
      <HydrateClient>
        <div className="flex h-screen overflow-hidden">
          <AppSidebar isAdmin={true} />
          <div className="flex flex-1 flex-col overflow-hidden bg-[#f7f6f3]">
            {children}
          </div>
        </div>
      </HydrateClient>
    </SidebarProvider>
  );
}
