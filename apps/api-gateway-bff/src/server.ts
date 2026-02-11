import { env } from './config';
import { app } from './app';
import { createLogger } from '@sofia/observability';
import { envDebug } from '@sofia/config';

envDebug('api-gateway-bff');

const log = createLogger('api-gateway-bff');

app.listen(env.PORT, () => {
  log.info(`api-gateway-bff escuchando en http://localhost:${env.PORT}`);
});
