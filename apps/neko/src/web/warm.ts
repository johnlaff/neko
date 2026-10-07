import type { QueryClient } from "@tanstack/react-query";

/** The service worker's copy of the last good answers (see public/sw.js). */
const DATA_CACHE = "neko-data-v1";
const WARM = ["me", "projection", "history", "settings"] as const;

/**
 * Opens the app on the last copy this device already has, so the first paint shows numbers
 * instead of a skeleton. The copies count as stale, so every screen still asks the network at
 * once and replaces them; logging out deletes the cache, so nothing is warmed after that.
 */
export const warmFromDevice = async (queryClient: QueryClient) => {
  if (!("caches" in globalThis)) return;
  try {
    const cache = await caches.open(DATA_CACHE);
    await Promise.all(
      WARM.map(async (key) => {
        const hit = await cache.match(`/api/${key}`);
        if (!hit?.ok) return;
        queryClient.setQueryData([key], await hit.json(), { updatedAt: 0 });
      }),
    );
  } catch {
    // Storage blocked or a copy unreadable: start from the network as before.
  }
};
