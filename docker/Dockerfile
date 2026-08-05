# Web process: serves the embedded app UI + API routes.
# Build from the repo root: docker build -f docker/Dockerfile -t duplify-web .
FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000
WORKDIR /app
ENV NODE_ENV=production
# Railway's proxy must reach the server on the container's public interface.
# Binding explicitly avoids a 502 even when Node chooses an IPv6-only default.
ENV HOST=0.0.0.0

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

RUN npm run build

CMD ["npm", "run", "docker-start"]
