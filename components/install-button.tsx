"use client";

import { Check, Copy, Download, Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useInstall } from "@/axon/hooks";
import { defaultTarget, type InstallTarget } from "@/axon/install";
import type { Skill } from "@/types/skill";

interface Props extends Omit<ButtonProps, "onClick"> {
  skill: Skill;
  target?: InstallTarget;
  label?: string;
}

/** Quick-install: copies the client config to the clipboard and records the install. */
export function InstallButton({ skill, target, label = "Install", size = "sm", variant = "default", ...rest }: Props) {
  const { install, status } = useInstall(skill);
  const icon = status === "busy" ? <Loader2 className="animate-spin" /> : status === "done" ? <Check /> : status === "error" ? <Copy /> : <Download />;
  const text = status === "done" ? "Copied" : status === "error" ? "Retry" : label;

  return (
    <Button size={size} variant={variant} onClick={() => install(target ?? defaultTarget(skill))} disabled={status === "busy"} aria-live="polite" {...rest}>
      {icon}
      {text}
    </Button>
  );
}
