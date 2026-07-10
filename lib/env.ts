import "server-only";

export function getEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && !value.startsWith("replace-with") && !value.includes("your-") ? value : undefined;
}

export function getFirstEnv(names: string[]): string | undefined {
  for (const name of names) {
    const value = getEnv(name);
    if (value) return value;
  }
  return undefined;
}

export function maskSecret(value?: string): string | null {
  if (!value) return null;
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 3)}...${value.slice(-4)}`;
}
