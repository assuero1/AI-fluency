import { pathToFileURL } from "node:url";
import { readEnv, required, teableRequest } from "./qa-env.mjs";

const FIELD_PLAN = [
  {
    envName: "TEABLE_CONVERSATIONS_TABLE_ID",
    fields: [
      {
        type: "singleSelect",
        name: "interaction_mode",
        description: "Chat v2 interaction type; blank legacy rows behave as conversation.",
        options: { choices: [
          { name: "conversation", color: "greenBright" },
          { name: "simulation", color: "purpleBright" }
        ] }
      },
      {
        type: "number",
        name: "target_user_message_count",
        description: "Optional learner message goal; 0 or blank disables it."
      }
    ]
  },
  {
    envName: "TEABLE_MESSAGES_TABLE_ID",
    fields: [
      {
        type: "singleSelect",
        name: "channel",
        description: "practice or teacher; blank legacy rows behave as practice.",
        options: { choices: [
          { name: "practice", color: "greenBright" },
          { name: "teacher", color: "blueBright" }
        ] }
      }
    ]
  }
];

const CHOICE_COLORS = ["grayBright", "greenBright", "yellowBright", "blueBright", "purpleBright", "redBright"];

function mergeChoicePayload(existingField, expectedChoices) {
  const currentChoices = existingField.options?.choices ?? [];
  const currentNames = new Set(currentChoices.map((choice) => choice.name));
  const choices = [
    ...currentChoices,
    ...expectedChoices
      .filter((choice) => !currentNames.has(choice))
      .map((choice, index) => ({
        name: choice,
        color: CHOICE_COLORS[(currentChoices.length + index) % CHOICE_COLORS.length]
      }))
  ];
  return {
    type: "singleSelect",
    name: existingField.name,
    options: {
      ...(existingField.options ?? {}),
      choices
    }
  };
}

async function main() {
  const option = (name) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
  };
  const env = readEnv(option("--env") ?? ".env.local");
  const apply = process.argv.includes("--apply");
  const report = [];

  for (const table of FIELD_PLAN) {
    const tableId = required(env, table.envName);
    const existing = await teableRequest(env, `/api/table/${tableId}/field`);
    const existingByName = new Map((Array.isArray(existing) ? existing : []).map((field) => [field?.name, field]));

    for (const field of table.fields) {
      const existingField = existingByName.get(field.name);
      let created = null;

      if (!existingField) {
        if (apply) {
          created = await teableRequest(env, `/api/table/${tableId}/field`, {
            method: "POST",
            body: JSON.stringify({ ...field, notNull: false })
          });
        }
        report.push({
          table: table.envName,
          name: field.name,
          fieldExists: Boolean(created),
          fieldId: created?.id ?? null,
          action: apply ? "created" : "create-required"
        });
        continue;
      }

      if (field.type === "singleSelect" && field.options?.choices) {
        const currentNames = new Set((existingField.options?.choices ?? []).map((choice) => choice.name));
        const missingChoices = field.options.choices
          .map((choice) => choice.name)
          .filter((choice) => !currentNames.has(choice));
        if (missingChoices.length) {
          if (apply) {
            await teableRequest(env, `/api/table/${tableId}/field/${existingField.id}/convert`, {
              method: "PUT",
              body: JSON.stringify(mergeChoicePayload(existingField, field.options.choices.map((choice) => choice.name)))
            });
          }
          report.push({
            table: table.envName,
            name: field.name,
            fieldExists: true,
            fieldId: existingField.id,
            action: apply ? "choices-added" : "choices-required",
            missingChoices
          });
          continue;
        }
      }

      report.push({
        table: table.envName,
        name: field.name,
        fieldExists: true,
        fieldId: existingField.id,
        action: "none"
      });
    }
  }

  console.log(JSON.stringify({ ok: true, mode: apply ? "apply" : "dry-run", fields: report }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
