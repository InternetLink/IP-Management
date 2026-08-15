import 'reflect-metadata';

import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';

@Injectable()
class TypedGreetingProvider {
  getMessage(): string {
    return 'ready';
  }
}

describe('Jest TypeScript transform', () => {
  it('compiles a typed Nest provider and executes an assertion', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [TypedGreetingProvider],
    }).compile();

    expect(moduleRef.get(TypedGreetingProvider).getMessage()).toBe('ready');
    await moduleRef.close();
  });
});
