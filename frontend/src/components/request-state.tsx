"use client";

import {ArrowsRotateRight, CircleExclamation} from "@gravity-ui/icons";
import {Button, Spinner} from "@heroui/react";

import type {ApiDataStatus} from "../lib/use-api";

type RequestStateProps = {
  readonly error: Error | null;
  readonly errorTitle?: string;
  readonly onRetryAction: () => Promise<void> | void;
  readonly status: ApiDataStatus;
};

export function RequestState({
  error,
  errorTitle = "Unable to load data",
  onRetryAction,
  status,
}: RequestStateProps) {
  if (status === "error") {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/5 p-4" role="alert">
        <CircleExclamation className="mt-0.5 size-5 shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{errorTitle}</p>
          <p className="mt-1 break-words text-xs text-muted">{error?.message ?? "Request failed"}</p>
        </div>
        <Button size="sm" variant="danger-soft" onPress={() => void onRetryAction()}>
          <ArrowsRotateRight className="size-4" />
          Retry
        </Button>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted" role="status">
        <Spinner size="sm" />
        <span>Refreshing...</span>
      </div>
    );
  }

  return null;
}
