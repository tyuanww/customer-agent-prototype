import {
  formatApiShutdownFailure,
  formatApiStartupFailure,
  type ApiShutdownSignal,
} from './runtime-config.js';
import { startApi } from './server.js';

async function run(): Promise<void> {
  try {
    const started = await startApi();
    console.info(
      `[api] listening at ${started.address} profile=${started.config.profile} runtime_activated=${String(started.config.runtimeActivated)}`,
    );

    let closing = false;
    const close = (signal: ApiShutdownSignal): void => {
      if (closing) return;
      closing = true;
      void started.close()
        .then(() => {
          console.info(`[api] closed after ${signal}`);
        })
        .catch(() => {
          console.error(formatApiShutdownFailure(signal));
          process.exitCode = 1;
        });
    };
    process.once('SIGINT', () => close('SIGINT'));
    process.once('SIGTERM', () => close('SIGTERM'));
  } catch (error: unknown) {
    console.error(formatApiStartupFailure(error));
    process.exitCode = 1;
  }
}

void run();
