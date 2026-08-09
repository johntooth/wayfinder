// Reports schema changes that have no generated migration behind them.
//
// The obvious way to ask this question is `drizzle-kit push`, and it is the
// wrong one: push introspects the live database, and several constructs in this
// schema (a unique constraint's column order, the HNSW index's `with` options,
// an array column's default) come back from introspection in a shape that never
// matches the snapshot, so push always finds work to do and asks to truncate
// tables that hold rows. Diffing the schema against its own snapshot has no such
// blind spot — and needs no database, so CI can run it too.
//
// Exit code 1 means drift. The caller decides what that is worth: restart.sh
// warns and carries on, validate.sh fails.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsFolder = join(packageRoot, "drizzle");
// drizzle-kit resolves --out against the working directory, so the scratch
// folder has to sit inside the package and be named relatively.
const scratchFolder = join("node_modules", ".cache", "schema-drift");
const scratchPath = join(packageRoot, scratchFolder);

const sqlFilesIn = (folder) => readdirSync(folder).filter((name) => name.endsWith(".sql"));

rmSync(scratchPath, { recursive: true, force: true });
mkdirSync(scratchPath, { recursive: true });
cpSync(join(migrationsFolder, "meta"), join(scratchPath, "meta"), { recursive: true });

// stdin is closed deliberately: drizzle-kit asks whether a dropped-and-added
// column pair is a rename, and a start-up script must never hang on a question.
// Refusing the prompt turns that case into drift, which is the honest answer.
const generate = spawnSync(
  join(packageRoot, "node_modules", ".bin", "drizzle-kit"),
  [
    "generate",
    "--dialect",
    "postgresql",
    "--schema",
    "./src/db/schema/index.ts",
    "--out",
    scratchFolder,
  ],
  { cwd: packageRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);

const generated = sqlFilesIn(scratchPath);
const generatedSql = generated
  .map((name) => readFileSync(join(scratchPath, name), "utf8").trim())
  .join("\n");
rmSync(scratchPath, { recursive: true, force: true });

if (generate.status !== 0 && generated.length === 0) {
  console.error("  could not compare the schema against its migrations:");
  console.error(`${generate.stderr || generate.stdout}`.trim());
  process.exit(1);
}

if (generated.length === 0) {
  console.log("  schema matches its migrations");
  process.exit(0);
}

const schemaFolder = relative(process.cwd(), join(packageRoot, "src", "db", "schema"));
console.error(`  ${schemaFolder} has changes with no migration behind them:`);
console.error(
  generatedSql
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n"),
);
console.error("  run `pnpm db:generate`, review the SQL, and commit it with the schema change.");
process.exit(1);
