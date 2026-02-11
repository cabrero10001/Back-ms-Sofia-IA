import { env } from './config';
import { app } from './app';
import { createLogger } from '@sofia/observability';
import { envDebug } from '@sofia/config';

envDebug('ms-dashboard');

const log = createLogger('ms-dashboard');

app.listen(env.PORT, () => {
  log.info(`ms-dashboard escuchando en http://localhost:${env.PORT}`);
});
