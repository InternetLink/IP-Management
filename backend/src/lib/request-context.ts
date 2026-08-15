import { AsyncLocalStorage } from 'async_hooks';

export type RequestCtx = {
  requestId: string | null;
  userId: string | null;
  username: string | null;
};

export const requestContext = new AsyncLocalStorage<RequestCtx>();

export function getRequestCtx(): RequestCtx {
  return requestContext.getStore() ?? { requestId: null, userId: null, username: null };
}
