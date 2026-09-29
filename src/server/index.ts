import { config } from "./config.js";
import { buildApp } from "./app.js";
const { app } = await buildApp(config, { logger: true });
await app.listen({ port: config.PORT, host: config.HOST });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
