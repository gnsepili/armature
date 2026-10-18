import models from "../catalog/models.json" with { type: "json" };
import versions from "../catalog/versions.json" with { type: "json" };

export interface ModelEntry {
  provider: string;
  id: string;
  context_window: number;
  capabilities: string[];
  /** USD per 1M tokens. */
  price: { input: number; output: number };
  price_note?: string;
  suggested?: boolean;
}

export interface FrameworkPins {
  packages: Record<string, string>;
  providers: Record<string, Record<string, string>>;
  session_backends: Record<string, Record<string, string>>;
}

export interface VersionsCatalog {
  catalog_version: number;
  verified_at: string;
  python: { requires: string; default: string; supported: string[] };
  common: Record<string, string>;
  dev: Record<string, string>;
  /** PEP 517 build backend pinned in generated pyproject files. */
  build: Record<string, string>;
  frameworks: Record<string, FrameworkPins>;
}

export const versionsCatalog = versions as VersionsCatalog;
export const modelCatalog = models.models as ModelEntry[];

export function findModel(provider: string, id: string): ModelEntry | undefined {
  return modelCatalog.find((m) => m.provider === provider && m.id === id);
}

export function suggestedModels(provider?: string): ModelEntry[] {
  return modelCatalog.filter((m) => m.suggested && (!provider || m.provider === provider));
}
