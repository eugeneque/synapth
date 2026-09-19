"use client";

import { useCallback, useState } from "react";
import { axon, AxonError } from "@/axon/client";
import { installSnippet, defaultTarget, type InstallTarget } from "@/axon/install";
import type { Skill } from "@/types/skill";
import type { ExecutionReceipt } from "@/types/economy";

type Status = "idle" | "busy" | "done" | "error";

/** Copies the install snippet, records the install in Cortex, reports the new counter. */
export function useInstall(skill: Skill) {
  const [status, setStatus] = useState<Status>("idle");
  const [downloads, setDownloads] = useState(skill.downloadsCount);
  const [error, setError] = useState<string | null>(null);

  const install = useCallback(
    async (target: InstallTarget = defaultTarget(skill)) => {
      setStatus("busy");
      setError(null);
      try {
        const snippet = installSnippet(skill, target);
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          await navigator.clipboard.writeText(snippet.code);
        }
        const res = await axon.skills.install(skill.id, target);
        setDownloads(res.downloadsCount);
        setStatus("done");
        setTimeout(() => setStatus("idle"), 1800);
        return snippet;
      } catch (e) {
        setStatus("error");
        setError(e instanceof AxonError ? e.message : "Install failed");
        return null;
      }
    },
    [skill],
  );

  return { install, status, downloads, error };
}

/** Runs a paid execution through the gateway and exposes the receipt. */
export function useExecute(skill: Skill) {
  const [status, setStatus] = useState<Status>("idle");
  const [receipt, setReceipt] = useState<ExecutionReceipt | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(
    async (tool: string | null, input: unknown) => {
      setStatus("busy");
      setError(null);
      try {
        const res = await axon.skills.execute(skill.id, tool, input);
        setReceipt(res.receipt);
        setResult(res.result);
        setStatus("done");
      } catch (e) {
        setStatus("error");
        setError(e instanceof AxonError ? e.message : "Execution failed");
      }
    },
    [skill.id],
  );

  return { execute, status, receipt, result, error };
}
