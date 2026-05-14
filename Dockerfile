FROM node:22-slim AS gitnexus-builder

RUN apt-get update && \
    apt-get install -y --no-install-recommends git python3 make g++ && \
    echo "deb http://deb.debian.org/debian trixie main" > /etc/apt/sources.list.d/trixie.list && \
    apt-get update && apt-get install -y --no-install-recommends -t trixie libstdc++6 && \
    rm -rf /var/lib/apt/lists/* /etc/apt/sources.list.d/trixie.list

WORKDIR /build

COPY ai-context-gitnexus/gitnexus-shared/ ./gitnexus-shared/
COPY ai-context-gitnexus/gitnexus/ ./gitnexus/

# 1. Build gitnexus-shared (force rebuild to bypass stale tsbuildinfo)
RUN cd gitnexus-shared && npm install && rm -f tsconfig.tsbuildinfo && npx tsc -b --force

# 2. Install gitnexus deps (with scripts for native addons) and build
#    Remove prepare/prepack scripts to prevent auto-build before shared is linked
RUN cd gitnexus && rm -rf node_modules && \
    node -e "const p=require('./package.json'); delete p.scripts.prepare; delete p.scripts.prepack; require('fs').writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')" && \
    npm install && \
    npm run build

# ---- runtime ----
FROM node:22-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends git python3 python3-venv python3-pip && \
    echo "deb http://deb.debian.org/debian trixie main" > /etc/apt/sources.list.d/trixie.list && \
    apt-get update && apt-get install -y --no-install-recommends -t trixie libstdc++6 && \
    rm -rf /var/lib/apt/lists/* /etc/apt/sources.list.d/trixie.list

# Copy built gitnexus and create bin link
COPY --from=gitnexus-builder /build/gitnexus/dist /opt/gitnexus/dist
COPY --from=gitnexus-builder /build/gitnexus/node_modules /opt/gitnexus/node_modules
COPY --from=gitnexus-builder /build/gitnexus/hooks /opt/gitnexus/hooks
COPY --from=gitnexus-builder /build/gitnexus/scripts /opt/gitnexus/scripts
COPY --from=gitnexus-builder /build/gitnexus/skills /opt/gitnexus/skills
COPY --from=gitnexus-builder /build/gitnexus/vendor /opt/gitnexus/vendor
COPY --from=gitnexus-builder /build/gitnexus/package.json /opt/gitnexus/package.json
RUN ln -s /opt/gitnexus/dist/cli/index.js /usr/local/bin/gitnexus && chmod +x /opt/gitnexus/dist/cli/index.js

RUN gitnexus --version

WORKDIR /app

COPY ai-context-service/requirements.txt .
RUN pip install --no-cache-dir --break-system-packages -r requirements.txt

COPY ai-context-service/app/ app/
COPY ai-context-service/alembic/ alembic/
COPY ai-context-service/alembic.ini .
COPY ai-context-service/create_user.py .

ENV REPOS_ROOT_DIR=/data/repos
ENV GITNEXUS_HOME=/data/repos/.gitnexus

RUN mkdir -p /data/repos

EXPOSE 8000

CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
