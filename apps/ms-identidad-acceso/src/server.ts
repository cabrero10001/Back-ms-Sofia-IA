import { env } from './config';
import { app } from './app';
import { createLogger } from '@sofia/observability';
import { envDebug } from '@sofia/config';

envDebug('ms-identidad-acceso');

const log = createLogger('ms-identidad-acceso');

app.listen(env.PORT, () => {
  log.info(`ms-identidad-acceso escuchando en http://localhost:${env.PORT}`);
});
