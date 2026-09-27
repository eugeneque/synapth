/**
 * Cortex · Content hashes and the platform signature (ТЗ FR-AI-40, FR-AI-43).
 *
 * `contentHash` = SHA-256 over the sorted list of "path\0sha256(file)" lines,
 * so a client can check each file it received and the set as a whole. The
 * platform signs the contentHash with Ed25519; the public key is published
 * in `/.well-known/synapth.json`.
 *
 * Key material: `SYNAPTH_SIGNING_KEY` (PKCS#8 PEM, or its base64). Without it
 * a key pair is generated per process — fine for development, but signatures
 * then do not survive a restart, so production must set the variable.
 * (Gov bundles use ГОСТ Р 34.10-2012 through a certified CSP — not here.)
 */

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import type { Skill } from "@/types/skill";

export interface SignedFile {
  path: string;
  content: string;
  sha256: string;
}

export interface PlatformSignature {
  alg: "Ed25519";
  keyId: string;
  /** base64 signature over the UTF-8 contentHash. */
  value: string;
}

export const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export function contentHash(files: Array<Pick<SignedFile, "path" | "sha256">>): string {
  const lines = files.map((f) => `${f.path}\0${f.sha256}`).sort();
  return sha256(lines.join("\n"));
}

/** Stable JSON: sorted keys, so the manifest hash does not depend on insertion order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The files an agent receives for a skill: its manifest and, for prompt skills, the SKILL.md body. */
export function skillFiles(skill: Pick<Skill, "manifest">, fullPrompt: string | null): SignedFile[] {
  const { systemPromptTruncated: _t, ...manifest } = skill.manifest;
  const files: Array<Omit<SignedFile, "sha256">> = [{ path: "synapth.json", content: canonicalJson({ ...manifest, systemPrompt: fullPrompt ?? manifest.systemPrompt }) }];
  const prompt = fullPrompt ?? skill.manifest.systemPrompt;
  if (prompt) files.push({ path: "SKILL.md", content: prompt });
  return files.map((f) => ({ ...f, sha256: sha256(f.content) }));
}

// ---------------------------------------------------------------------------
// Ed25519
// ---------------------------------------------------------------------------

interface KeyPair {
  privateKey: KeyObject;
  publicKey: KeyObject;
  keyId: string;
  ephemeral: boolean;
}

const g = globalThis as unknown as { __synapthSigningKey_v1?: KeyPair };

function loadKeyPair(): KeyPair {
  if (g.__synapthSigningKey_v1) return g.__synapthSigningKey_v1;
  const raw = process.env.SYNAPTH_SIGNING_KEY?.trim();
  let privateKey: KeyObject;
  let ephemeral = false;
  if (raw) {
    const pem = raw.includes("BEGIN") ? raw : Buffer.from(raw, "base64").toString("utf8");
    privateKey = createPrivateKey(pem);
  } else {
    privateKey = generateKeyPairSync("ed25519").privateKey;
    ephemeral = true;
  }
  const publicKey = createPublicKey(privateKey);
  const der = publicKey.export({ format: "der", type: "spki" });
  const keyId = `ed25519:${createHash("sha256").update(der).digest("hex").slice(0, 16)}`;
  return (g.__synapthSigningKey_v1 = { privateKey, publicKey, keyId, ephemeral });
}

export function signContentHash(hash: string): PlatformSignature {
  const { privateKey, keyId } = loadKeyPair();
  return { alg: "Ed25519", keyId, value: sign(null, Buffer.from(hash, "utf8"), privateKey).toString("base64") };
}

export function verifyContentHash(hash: string, signature: PlatformSignature): boolean {
  const { publicKey, keyId } = loadKeyPair();
  if (signature.keyId !== keyId) return false;
  return verify(null, Buffer.from(hash, "utf8"), publicKey, Buffer.from(signature.value, "base64"));
}

/** For `/.well-known/synapth.json`. */
export function publicSigningKey(): { alg: "Ed25519"; keyId: string; spki: string; ephemeral: boolean } {
  const { publicKey, keyId, ephemeral } = loadKeyPair();
  return { alg: "Ed25519", keyId, spki: publicKey.export({ format: "pem", type: "spki" }).toString(), ephemeral };
}
