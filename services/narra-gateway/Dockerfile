FROM node:24.20.0-alpine3.23@sha256:0388af2af070cd4736a1567cfed02469ba117848845b4165d87a333edb53d2ca

WORKDIR /app
RUN apk add --no-cache ffmpeg poppler-utils
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

ARG GATEWAY_BUILD_VERSION=development
ENV NODE_ENV=production \
    GATEWAY_BUILD_VERSION=${GATEWAY_BUILD_VERSION}

COPY --chown=node:node *.mjs *.pem ./
COPY --chown=node:node evaluation ./evaluation
COPY --chown=node:node cover-generation-config.json ./
COPY --chown=node:node data ./data
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node operator-ui ./operator-ui

USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "index.mjs"]
