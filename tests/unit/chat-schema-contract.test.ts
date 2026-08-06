import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("chat v2 schema contract", () => {
  const schema = read("lib/teable/schema.ts");
  const setup = read("scripts/setup-teable-schema.mjs");
  const ensure = read("scripts/ensure-chat-fields.mjs");

  it("registers interaction_mode, target_user_message_count and channel in the TypeScript schema", () => {
    expect(schema).toContain('{ name: "interaction_mode", type: "singleSelect"');
    expect(schema).toContain('{ name: "target_user_message_count", type: "number"');
    expect(schema).toContain('{ name: "channel", type: "singleSelect"');
  });

  it("registers the fields and choices in the full setup script", () => {
    expect(setup).toContain('["interaction_mode", "singleSelect"]');
    expect(setup).toContain('["target_user_message_count", "number"]');
    expect(setup).toContain('["channel", "singleSelect"]');
    expect(setup).toContain('interaction_mode: ["conversation", "simulation"]');
    expect(setup).toContain('channel: ["practice", "teacher"]');
  });

  it("creates an idempotent additive migration script with dry-run default", () => {
    expect(ensure).toContain('name: "interaction_mode"');
    expect(ensure).toContain('name: "target_user_message_count"');
    expect(ensure).toContain('name: "channel"');
    expect(ensure).toContain('{ name: "conversation", color: "greenBright" }');
    expect(ensure).toContain('{ name: "simulation", color: "purpleBright" }');
    expect(ensure).toContain('{ name: "practice", color: "greenBright" }');
    expect(ensure).toContain('{ name: "teacher", color: "blueBright" }');
    expect(ensure).toContain("--apply");
    expect(ensure).toContain("notNull: false");
  });
});
