import { env } from './config';
import { app } from './app';
import { createLogger } from '@sofia/observability';
import { envDebug } from '@sofia/config';

envDebug('conversation-service');

const log = createLogger('conversation-service');

app.listen(env.PORT, () => {
  log.info(`conversation-service escuchando en http://localhost:${env.PORT}`);
});
