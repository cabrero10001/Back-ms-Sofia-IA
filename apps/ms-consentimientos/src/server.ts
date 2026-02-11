import { env } from './config';
import { app } from './app';
import { createLogger } from '@sofia/observability';
import { envDebug } from '@sofia/config';

envDebug('ms-consentimientos');

const log = createLogger('ms-consentimientos');

app.listen(env.PORT, () => {
  log.info(`ms-consentimientos escuchando en http://localhost:${env.PORT}`);
});
