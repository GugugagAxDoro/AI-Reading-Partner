import { createApp } from './app';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';

const { app, close } = await createApp({ logger: true });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    close();
    process.exit(0);
  });
}

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  close();
  process.exit(1);
}
