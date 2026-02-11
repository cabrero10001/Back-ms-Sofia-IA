import { env } from './config';
import { app } from './app';
import { createLogger } from '@sofia/observability';
import { envDebug } from '@sofia/config';

envDebug('ms-normativa');

const log = createLogger('ms-normativa');

app.listen(env.PORT, () => {
  log.info(`ms-normativa escuchando en http://localhost:${env.PORT}`);
});
