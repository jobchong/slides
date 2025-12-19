FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production
COPY server ./server
EXPOSE 4000
CMD ["bun", "run", "server/server.ts"]
