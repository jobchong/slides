# Build stage - build frontend
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
COPY app ./app
RUN bun install
RUN bun run build:client

# Production stage
FROM oven/bun:1
WORKDIR /app

# Install unzip for PPTX import
RUN apt-get update && apt-get install -y unzip && rm -rf /var/lib/apt/lists/*

# Copy dependencies
COPY package.json bun.lock ./
RUN bun install --production

# Copy server code
COPY server ./server

# Copy built frontend from builder
COPY --from=builder /app/app/dist ./app/dist

# Environment
ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000
CMD ["bun", "run", "server/server.ts"]
