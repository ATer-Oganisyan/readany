FROM node:20.19.5-alpine3.22@sha256:6178e78b972f79c335df281f4b7674a2d85071aae2af020ffa39f0a770265435

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
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node operator-ui ./operator-ui

USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "index.mjs"]
