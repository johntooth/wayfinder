import { cookies } from "next/headers";
import { getContainer } from "@/lib/container";
import type { TrpcContext } from "./trpc";

export const createServerTrpcContext = async (): Promise<TrpcContext> => {
  const cookieStore = await cookies();
  const token = cookieStore.get("better-auth.session_token")?.value ?? null;
  const container = getContainer();

  let userId: string | null = null;
  let isAdmin = false;

  if (token) {
    const session = await container.resolveSession(token);
    if (session) {
      userId = session.userId;
      isAdmin = session.isAdmin;
    }
  }

  return { container, userId, isAdmin, headers: new Headers() };
};
