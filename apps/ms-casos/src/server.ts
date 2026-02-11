import { env } from './config';
import { app } from './app';
import { createLogger } from '@sofia/observability';
import { envDebug } from '@sofia/config';

envDebug('ms-casos');

const log = createLogger('ms-casos');

app.listen(env.PORT, () => {
  log.info(`ms-casos escuchando en http://localhost:${env.PORT}`);
});
