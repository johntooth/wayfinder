import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  transpilePackages: [
    "@rbrasier/domain",
    "@rbrasier/application",
    "@rbrasier/adapters",
    "@rbrasier/shared",
  ],
  serverExternalPackages: [
    "pino",
    "pino-pretty",
    "@opentelemetry/sdk-node",
    "@opentelemetry/instrumentation",
    "@opentelemetry/instrumentation-http",
    "@opentelemetry/instrumentation-express",
    "@opentelemetry/instrumentation-pg",
    "require-in-the-middle",
  ],
  webpack: (config) => {
    // require-in-the-middle uses dynamic require() calls that webpack cannot
    // statically analyse, producing "Critical dependency" build warnings.
    // The package is already excluded from bundling via serverExternalPackages;
    // noParse tells webpack to skip parsing it so the warning is not emitted.
    const existing = config.module?.noParse;
    const existing_rules: (RegExp | string)[] = Array.isArray(existing)
      ? existing
      : existing != null
        ? [existing as RegExp | string]
        : [];
    config.module.noParse = [...existing_rules, /node_modules[\\/]require-in-the-middle[\\/]/];

    // pino-logger.ts uses createRequire(path.join(process.cwd(), "index.js")) to
    // load pino-pretty as a synchronous stream.  Webpack's NodeStuffPlugin tries
    // to statically evaluate the argument and emits a false-positive warning
    // because process.cwd() is not a compile-time constant.  pino and pino-pretty
    // are already in serverExternalPackages so this is purely a build-analysis
    // artefact — suppress it without changing runtime behaviour.
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      { module: /pino-logger/, message: /createRequire/ },
    ];

    return config;
  },
};

export default config;
