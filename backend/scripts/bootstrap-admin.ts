import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import type { BootstrapAdminDto } from '../src/auth/auth.dto';
import {
  AuthService,
  BootstrapAlreadyCompletedException,
} from '../src/auth/auth.service';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readBootstrapInput(): { readonly token: string; readonly data: BootstrapAdminDto } {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();

  return {
    token: requiredEnvironment('BOOTSTRAP_TOKEN'),
    data: {
      username: requiredEnvironment('BOOTSTRAP_ADMIN_USERNAME'),
      password: requiredEnvironment('BOOTSTRAP_ADMIN_PASSWORD'),
      ...(email ? { email } : {}),
    },
  };
}

async function main(): Promise<void> {
  const { data, token } = readBootstrapInput();
  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const auth = app.get(AuthService);
    try {
      await auth.bootstrapViaOperatorFlow(data, token);
      console.log('Bootstrap completed.');
    } catch (error) {
      if (error instanceof BootstrapAlreadyCompletedException) {
        console.log('Bootstrap already completed; no action taken.');
        return;
      }
      throw error;
    }
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    if (error instanceof Error) console.error(error.message);
    else console.error('Bootstrap failed with an unknown error');
    process.exitCode = 1;
  });
}
