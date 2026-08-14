import { describe, expect, it, vi } from "vitest";

import {
  createSignedDownloadTargets,
  createSignedUploadTargets,
  uploadSigningConcurrency,
  type SharedMediaFile,
  type SharedProfileStorage
} from "../api/_shared-profile-signing.js";

function mediaFiles(count: number): SharedMediaFile[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: "images",
    filename: `signature-${String(index).padStart(3, "0")}.png`,
    size: 1024 + index,
    updatedAt: "2026-08-14T00:00:00.000Z",
    storagePath: `TEAM-QA/7/images/signature-${String(index).padStart(3, "0")}.png`
  }));
}

async function expectSignal(signal: Promise<void>, timeoutMs = 1_000): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error("expected concurrency signal was not observed")), timeoutMs);
  });
  try {
    await Promise.race([signal, timedOut]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

describe("shared-profile signed URL generation", () => {
  it("creates every download URL in one storage batch", async () => {
    const files = mediaFiles(275);
    const createSignedUrls = vi.fn(async (paths: string[]) => ({
      data: paths.map((path) => ({
        path,
        signedUrl: `https://storage.test/download/${encodeURIComponent(path)}`
      })),
      error: null
    }));
    const storage: SharedProfileStorage = {
      createSignedUploadUrl: vi.fn(),
      createSignedUrls
    };

    const targets = await createSignedDownloadTargets(storage, files, 3_600);

    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith(
      files.map((file) => file.storagePath),
      3_600
    );
    expect(targets).toHaveLength(files.length);
    expect(targets.map((target) => target.storagePath)).toEqual(
      files.map((file) => file.storagePath)
    );
  });

  it("bounds upload signing concurrency and preserves manifest order", async () => {
    const files = mediaFiles(275);
    let active = 0;
    let maxActive = 0;
    let started = 0;
    let releaseSigning: () => void = () => undefined;
    let signalConcurrency: () => void = () => undefined;
    const release = new Promise<void>((resolve) => {
      releaseSigning = resolve;
    });
    const reachedConcurrency = new Promise<void>((resolve) => {
      signalConcurrency = resolve;
    });
    const createSignedUploadUrl = vi.fn(async (storagePath: string) => {
      active += 1;
      started += 1;
      maxActive = Math.max(maxActive, active);
      if (started === uploadSigningConcurrency) {
        signalConcurrency();
      }
      await release;
      active -= 1;
      return {
        data: {
          signedUrl: `https://storage.test/upload/${encodeURIComponent(storagePath)}`,
          token: `token-${storagePath}`
        },
        error: null
      };
    });
    const storage: SharedProfileStorage = {
      createSignedUploadUrl,
      createSignedUrls: vi.fn()
    };

    const pendingTargets = createSignedUploadTargets(storage, files);
    await expectSignal(reachedConcurrency);

    expect(started).toBe(uploadSigningConcurrency);
    expect(maxActive).toBe(uploadSigningConcurrency);

    releaseSigning();
    const targets = await pendingTargets;

    expect(createSignedUploadUrl).toHaveBeenCalledTimes(files.length);
    expect(targets.map((target) => target.storagePath)).toEqual(
      files.map((file) => file.storagePath)
    );
  });
});
