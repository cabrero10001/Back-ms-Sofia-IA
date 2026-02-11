import { env } from './config';
import { app } from './app';
import { createLogger } from '@sofia/observability';
import { envDebug } from '@sofia/config';

envDebug('ms-atencion-whatsapp');

const log = createLogger('ms-atencion-whatsapp');

app.listen(env.PORT, () => {
  log.info(`ms-atencion-whatsapp escuchando en http://localhost:${env.PORT}`);
});
