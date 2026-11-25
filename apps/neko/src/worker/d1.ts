/**
 * D1 sometimes fails a query for a moment ("internal error", a dropped connection, a reset
 * object); Cloudflare's advice is to try again. Anything else is a real error and fails at once.
 */
const TRANSIENT_D1 = /D1_ERROR.*(internal error|network connection lost|reset)/i;

export const retryD1 = async <T>(
  run: () => Promise<T>,
  waits: number[] = [250, 1000, 3000],
): Promise<T> => {
  for (const wait of waits) {
    try {
      return await run();
    } catch (error) {
      if (!TRANSIENT_D1.test(error instanceof Error ? error.message : String(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  return run();
};
