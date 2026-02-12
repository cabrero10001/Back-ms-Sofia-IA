import { app } from './app';
import { env } from './config';
import { envDebug } from '@sofia/config';
import { createLogger } from '@sofia/observability';

envDebug('orchestrator-service');

const log = createLogger('orchestrator-service');

app.listen(env.PORT, () => {
  log.info(`orchestrator-service escuchando en http://localhost:${env.PORT}`);
});
