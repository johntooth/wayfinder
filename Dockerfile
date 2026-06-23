# Wayfinder app image (web + api share it), built for local podman experimentation.
# Debian/glibc base is required for the onnxruntime-node / @huggingface native deps.
# Runs the app via tsx / next dev — no production build — so AUTH_BYPASS (dev-only)
# is active. Secrets are injected at runtime via compose env_file, not baked in.
FROM node:20-bookworm

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app

# .dockerignore keeps host node_modules out of the context, so native modules are
# (re)built against this base rather than the host's newer glibc.
COPY . /app
RUN pnpm install --frozen-lockfile

EXPOSE 3000 3001

# Default command; each compose service overrides it (web=next dev, api=tsx, migrate).
CMD ["pnpm", "--filter", "@wayfinder/web", "dev"]
