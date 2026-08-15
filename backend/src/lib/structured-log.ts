import { getRequestCtx } from './request-context';

type LogFields = Readonly<Record<string, unknown>>;

export function formatLogEvent(
  event: string,
  fields: LogFields = {},
  requestId: string | null = getRequestCtx().requestId,
): string {
  return JSON.stringify({ ...fields, event, requestId });
}
