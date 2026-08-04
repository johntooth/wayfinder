import { defineConfig } from "drizzle-kit";

// drizzle-kit leaves the postgres driver's default notice handler in place, so a
// routine migrate/push prints every server NOTICE — "schema drizzle already
// exists, skipping" and friends — as a raw object that reads like a failure.
// client_min_messages is a server-side threshold, so raising it on this
// connection alone keeps warnings and errors while dropping the noise; the
// application's own connections are untouched.
const withQuietNotices = (databaseUrl: string): string => {
  if (databaseUrl === "") return databaseUrl;
  const url = new URL(databaseUrl);
  url.searchParams.set("options", "-c client_min_messages=warning");
  return url.toString();
};

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: withQuietNotices(process.env["DATABASE_URL"] ?? ""),
  },
});
