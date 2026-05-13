import * as fs from "fs";
import * as path from "path";

/** Persisted runtime state beside config.yaml */
export const STATE_FILENAME = "state.json";

export class ConfigState {
  constructor(private readonly statePath: string) {}

  /** Read persisted provider id from state file (sync); ignores invalid JSON */
  readCurrentProviderId(): string | undefined {
    try {
      if (!fs.existsSync(this.statePath)) {
        return undefined;
      }
      const raw = JSON.parse(fs.readFileSync(this.statePath, "utf-8")) as {
        currentProvider?: unknown;
      };
      return typeof raw.currentProvider === "string" ? raw.currentProvider : undefined;
    } catch {
      return undefined;
    }
  }

  async writeCurrentProviderId(id: string): Promise<void> {
    const dir = path.dirname(this.statePath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(
      this.statePath,
      JSON.stringify({ currentProvider: id }, null, 2),
      "utf-8"
    );
  }
}
