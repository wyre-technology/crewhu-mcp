# Multi-stage build for efficient container size
FROM node:26-alpine AS builder

ARG VERSION="unknown"
ARG COMMIT_SHA="unknown"
ARG BUILD_DATE="unknown"

WORKDIR /app

COPY package*.json .npmrc ./

RUN npm ci --ignore-scripts

COPY . .

RUN npm run build

# Production stage
FROM node:26-alpine AS production

RUN addgroup -g 1001 -S crewhu && \
    adduser -S crewhu -u 1001 -G crewhu

WORKDIR /app

COPY package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

RUN npm prune --omit=dev && npm cache clean --force

RUN mkdir -p /app/logs && chown -R crewhu:crewhu /app

USER crewhu

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV MCP_TRANSPORT=http
ENV MCP_HTTP_PORT=8080
ENV MCP_HTTP_HOST=0.0.0.0
# Set to 'gateway' for hosted deployment where the MCP gateway injects credentials
ENV AUTH_MODE=gateway

VOLUME ["/app/logs"]

CMD ["node", "dist/index.js"]

ARG VERSION="unknown"
ARG COMMIT_SHA="unknown"
ARG BUILD_DATE="unknown"

LABEL maintainer="engineering@wyre.ai"
LABEL version="${VERSION}"
LABEL description="Crewhu MCP Server"
LABEL org.opencontainers.image.title="crewhu-mcp"
LABEL org.opencontainers.image.description="Model Context Protocol server for Crewhu — customer feedback, engagement, and gamification"
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.created="${BUILD_DATE}"
LABEL org.opencontainers.image.revision="${COMMIT_SHA}"
LABEL org.opencontainers.image.source="https://github.com/wyre-technology/crewhu-mcp"
LABEL org.opencontainers.image.documentation="https://github.com/wyre-technology/crewhu-mcp/blob/main/README.md"
LABEL org.opencontainers.image.url="https://github.com/wyre-technology/crewhu-mcp/pkgs/container/crewhu-mcp"
LABEL org.opencontainers.image.vendor="Wyre Technology"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL io.modelcontextprotocol.server.name="io.github.wyre-technology/crewhu-mcp"
