import { readConfig } from './config.mjs';
import { createLeaderboardServer } from './http.mjs';
import { openStore } from './store.mjs';

const config = readConfig();
const store = openStore(config);
const server = createLeaderboardServer({ store, config });

server.listen(config.port, config.host, () => {
  console.log(`AIRSHIFT leaderboard listening on ${config.host}:${config.port}`);
});

function shutdown() {
  server.close(() => store.close());
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
