import { env } from './config';
import { app } from './app';
import { createLogger } from '@sofia/observability';
import { envDebug } from '@sofia/config';

envDebug('ms-gestion-estudiantes');

const log = createLogger('ms-gestion-estudiantes');

app.listen(env.PORT, () => {
  log.info(`ms-gestion-estudiantes escuchando en http://localhost:${env.PORT}`);
});
