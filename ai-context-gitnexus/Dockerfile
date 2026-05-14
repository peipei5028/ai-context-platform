FROM node:22-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends git python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY ai-context-gitnexus/gitnexus-shared/ ./gitnexus-shared/
COPY ai-context-gitnexus/gitnexus/ ./gitnexus/

# 1. Build gitnexus-shared (force rebuild to bypass stale tsbuildinfo)
RUN cd gitnexus-shared && npm install && rm -f tsconfig.tsbuildinfo && npx tsc -b --force

# 2. Build and install gitnexus
RUN cd gitnexus && rm -rf node_modules && npm install --ignore-scripts && \
    npm run build && npm install -g /build/gitnexus && \
    cd / && rm -rf /build
