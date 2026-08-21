import { buildApp } from './app.ts';
import { loadConfig } from './lib/config.ts';

const config = loadConfig();
const app = buildApp(config);

app
  .listen({ port: config.PORT, host: '0.0.0.0' })
  .then((address) => {
    app.log.info(`API escuchando en ${address}`);
  })
  .catch((err) => {
    app.log.error(err, 'Fallo al iniciar la API');
    process.exit(1);
  });
