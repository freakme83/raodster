import { readConfig } from './config.mjs';
import { openStore } from './store.mjs';

const store = openStore(readConfig());
store.close();
console.log('AIRSHIFT leaderboard database initialized');
