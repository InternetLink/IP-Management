"use client";

import type {ComponentPropsWithRef, ReactNode} from "react";

import {Button, Tooltip} from "@heroui/react";

type ButtonProps = ComponentPropsWithRef<typeof Button>;

export interface IconButtonProps extends Omit<ButtonProps, "children" | "isIconOnly"> {
  label: string;
  tooltip?: ReactNode;
  children: ReactNode;
}

export function IconButton({children, label, tooltip, ...buttonProps}: IconButtonProps) {
  return (
    <Tooltip>
      <Button isIconOnly aria-label={label} {...buttonProps}>
        {children}
      </Button>
      <Tooltip.Content>{tooltip ?? label}</Tooltip.Content>
    </Tooltip>
  );
}
