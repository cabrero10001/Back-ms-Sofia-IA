import { env } from './config';
import { app } from './app';
import { createLogger } from '@sofia/observability';
import { envDebug } from '@sofia/config';

envDebug('ms-citas-agenda');

const log = createLogger('ms-citas-agenda');

app.listen(env.PORT, () => {
  log.info(`ms-citas-agenda escuchando en http://localhost:${env.PORT}`);
});
