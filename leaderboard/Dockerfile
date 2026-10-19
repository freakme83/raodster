FROM node:24-bookworm-slim

WORKDIR /app
COPY package.json ./package.json
COPY src/physics.js ./src/physics.js
COPY leaderboard/package.json ./leaderboard/package.json
COPY leaderboard/src ./leaderboard/src
WORKDIR /app/leaderboard

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "src/server.mjs"]
