FROM oven/bun:latest

# Install curl (required by nexus.js)
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package dependencies and install
COPY package.json ./
RUN bun install

# Copy source code
COPY src/ ./src/

EXPOSE 4000

ENV PORT=4000

CMD ["bun", "run", "src/server.js"]
