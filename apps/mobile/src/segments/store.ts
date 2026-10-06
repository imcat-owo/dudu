/**
 * 真人式分段发送 — per-persona toggle store.
 *
 * Default ON (conservative: the splitter itself only fires on long
 * replies). She can turn it off per persona; the AI never changes it.
 * AsyncStorage-backed in production, injectable for tests.
 */

export interface SegmentStoreBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const KEY_PREFIX = "dudu.segments.v1.";

export class SegmentStore {
  constructor(private backend: SegmentStoreBackend) {}

  private key(personaId: string | null): string {
    return `${KEY_PREFIX}${personaId ?? "default"}`;
  }

  /** Default true —分段 is on unless she turned it off for this persona. */
  async isEnabled(personaId: string | null): Promise<boolean> {
    try {
      const v = await this.backend.getItem(this.key(personaId));
      return v !== "0";
    } catch {
      return true; // storage hiccup => fail open (harmless rendering choice)
    }
  }

  async setEnabled(personaId: string | null, enabled: boolean): Promise<void> {
    if (enabled) {
      await this.backend.removeItem(this.key(personaId));
    } else {
      await this.backend.setItem(this.key(personaId), "0");
    }
  }
}
