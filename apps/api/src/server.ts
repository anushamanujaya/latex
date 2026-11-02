import app from './app.js';
import { config } from './config.js';
import { connectDatabase, disconnectDatabase } from './db.js';

await connectDatabase();
const server = app.listen(config.PORT, () => console.log(`Latex API listening on port ${config.PORT}`));

async function shutdown() {
  server.close(async () => { await disconnectDatabase(); process.exit(0); });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
