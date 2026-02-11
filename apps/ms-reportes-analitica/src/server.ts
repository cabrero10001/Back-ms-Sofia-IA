import { env } from './config';
import { app } from './app';
import { createLogger } from '@sofia/observability';
import { envDebug } from '@sofia/config';

envDebug('ms-reportes-analitica');

const log = createLogger('ms-reportes-analitica');

app.listen(env.PORT, () => {
  log.info(`ms-reportes-analitica escuchando en http://localhost:${env.PORT}`);
});
