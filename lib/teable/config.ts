import { getEnv, getFirstEnv, maskSecret } from "@/lib/env";
import { teableSchema, TeableTableKey } from "./schema";

export type TeableConfig = {
  baseUrl?: string;
  apiKey?: string;
  baseId?: string;
  healthTableId?: string;
  tableIds: Partial<Record<TeableTableKey, string>>;
};

export function getTeableConfig(): TeableConfig {
  const tableIds: Partial<Record<TeableTableKey, string>> = {};

  for (const table of teableSchema) {
    const value = getEnv(table.envName);
    if (value) tableIds[table.key] = value;
  }

  return {
    baseUrl: getEnv("TEABLE_BASE_URL"),
    apiKey: getFirstEnv(["TEABLE_API_KEY", "TEABLE_TOKEN"]),
    baseId: getEnv("TEABLE_BASE_ID"),
    healthTableId: getFirstEnv(["TEABLE_HEALTH_TABLE_ID", "TEABLE_BOOKS_TABLE_ID", "TEABLE_NOTES_TABLE_ID"]),
    tableIds
  };
}

export function getTeableStatus() {
  const config = getTeableConfig();
  const mappedTables = teableSchema.filter((table) => config.tableIds[table.key]);
  const missingTables = teableSchema.filter((table) => !config.tableIds[table.key]);

  return {
    configured: Boolean(config.baseUrl && config.apiKey),
    hasBaseId: Boolean(config.baseId),
    baseUrlConfigured: Boolean(config.baseUrl),
    apiKeyConfigured: Boolean(config.apiKey),
    apiKeyMasked: maskSecret(config.apiKey),
    healthTableConfigured: Boolean(config.healthTableId),
    mappedTableCount: mappedTables.length,
    totalTableCount: teableSchema.length,
    missingTableEnvNames: missingTables.map((table) => table.envName),
    mappedTables: mappedTables.map((table) => ({
      key: table.key,
      displayName: table.displayName,
      envName: table.envName
    }))
  };
}
