import { test } from "node:test";
import assert from "node:assert/strict";
import { getProfile, getProfileByHandle, profileUpdateSchema, updateProfile, HandleTakenError } from "@/cortex/account";
import { AVATAR_IMAGE, COVER_IMAGE, OCCUPATIONS, dataUrlBytes, isImageDataUrl } from "@/types/profile";

/** A `data:image/jpeg;base64` URL carrying roughly `bytes` of payload. */
/** Base64 is always a multiple of 4 characters; the validator now insists on it. */
const jpegDataUrl = (bytes: number) => `data:image/jpeg;base64,${"A".repeat(Math.ceil(Math.ceil((bytes * 4) / 3) / 4) * 4)}`;

const base = { name: "Demo Creator", handle: "demo", bio: "", organization: "", location: "", website: "", defaultTarget: null };

test("dataUrlBytes decodes the base64 payload length", () => {
  assert.equal(dataUrlBytes("data:image/png;base64,AAAA"), 3);
  assert.equal(dataUrlBytes("data:image/png;base64,AAA="), 2);
  assert.equal(dataUrlBytes("https://example.com/a.png"), 0);
  assert.ok(isImageDataUrl("data:image/webp;base64,AAAA"));
  assert.ok(!isImageDataUrl("data:text/html;base64,AAAA"));
});

test("profile schema accepts uploaded images within the ceiling and rejects oversized or foreign payloads", () => {
  const ok = profileUpdateSchema.parse({ ...base, image: jpegDataUrl(AVATAR_IMAGE.maxBytes - 64), coverImage: jpegDataUrl(COVER_IMAGE.maxBytes - 64), occupation: "ai-architect" });
  assert.equal(ok.occupation, "ai-architect");
  assert.ok(ok.image?.startsWith("data:image/jpeg"));

  assert.throws(() => profileUpdateSchema.parse({ ...base, image: jpegDataUrl(AVATAR_IMAGE.maxBytes + 4096) }), /larger than/);
  assert.throws(() => profileUpdateSchema.parse({ ...base, coverImage: "data:text/html;base64,PHNjcmlwdD4=" }), /JPEG, PNG or WebP/);
  assert.throws(() => profileUpdateSchema.parse({ ...base, image: "http://insecure.example/a.png" }), /https URL/);
  assert.throws(() => profileUpdateSchema.parse({ ...base, image: "javascript:alert(1)" }), /https URL/);
  assert.throws(() => profileUpdateSchema.parse({ ...base, coverImage: "data:image/png;base64,<script>" }), /JPEG, PNG or WebP/);
  assert.throws(() => profileUpdateSchema.parse({ ...base, occupation: "wizard" }));

  // OAuth avatars stay as https URLs; empty strings collapse to null.
  const oauth = profileUpdateSchema.parse({ ...base, image: "https://avatars.githubusercontent.com/u/1", coverImage: "" });
  assert.equal(oauth.image, "https://avatars.githubusercontent.com/u/1");
  assert.equal(oauth.coverImage, null);
  assert.equal(oauth.occupation, null);
});

test("every occupation has a stable kebab-case id", () => {
  for (const o of OCCUPATIONS) assert.match(o, /^[a-z]+(-[a-z]+)*$/);
  assert.equal(new Set(OCCUPATIONS).size, OCCUPATIONS.length);
});

test("in-memory store round-trips avatar, cover, occupation and location", async () => {
  const before = await getProfile("usr_demo");
  assert.ok(before);
  const avatar = jpegDataUrl(1024);
  const cover = jpegDataUrl(4096);
  const updated = await updateProfile("usr_demo", { ...base, image: avatar, coverImage: cover, occupation: "ml-engineer", location: "Berlin, DE" });
  assert.equal(updated.image, avatar);
  assert.equal(updated.coverImage, cover);
  assert.equal(updated.occupation, "ml-engineer");
  assert.equal(updated.location, "Berlin, DE");
  assert.ok(Number.isFinite(Date.parse(updated.createdAt)));

  const byHandle = await getProfileByHandle("DEMO");
  assert.equal(byHandle?.coverImage, cover);

  // Removing the pictures falls back to the initial / generated canvas.
  const cleared = await updateProfile("usr_demo", { ...base, image: null, coverImage: null, occupation: null });
  assert.equal(cleared.image, null);
  assert.equal(cleared.coverImage, null);
  assert.equal(cleared.occupation, null);

  await assert.rejects(updateProfile("usr_demo", { ...base, handle: "acme" }), HandleTakenError);
  await updateProfile("usr_demo", { ...base, image: before.image, coverImage: before.coverImage, occupation: before.occupation, bio: before.bio, organization: before.organization, location: before.location, website: before.website, defaultTarget: before.defaultTarget });
});
