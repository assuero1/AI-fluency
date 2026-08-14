import tablesJson from "./tables.json";

// TeableTableKey é o nome histórico das chaves de tabela da fachada de dados;
// as 17 keys agora são derivadas de tables.json (backend Supabase).
export type TeableTableKey = (typeof tablesJson.tables)[number]["key"];
