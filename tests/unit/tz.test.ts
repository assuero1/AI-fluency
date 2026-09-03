import { describe, expect, it } from "vitest";
import { dateKeyInTimeZone, dayKeyFromDateColumn, resolveTimeZone } from "@/lib/learning/tz";

describe("dateKeyInTimeZone", () => {
  it("22:00 em São Paulo pertence ao mesmo dia local", () => {
    // 2026-09-03T01:00Z == 2026-09-02 22:00 em São Paulo (UTC-3)
    expect(dateKeyInTimeZone(new Date("2026-09-03T01:00:00Z"), "America/Sao_Paulo")).toBe("2026-09-02");
  });

  it("o mesmo instante em Tóquio cai no dia seguinte", () => {
    expect(dateKeyInTimeZone(new Date("2026-09-03T01:00:00Z"), "Asia/Tokyo")).toBe("2026-09-03");
  });

  it("data inválida devolve chave vazia", () => {
    expect(dateKeyInTimeZone(new Date("not-a-date"), "America/Sao_Paulo")).toBe("");
  });
});

describe("resolveTimeZone", () => {
  it("usa o fallback do app para valores vazios/inválidos", () => {
    expect(resolveTimeZone(undefined)).toBe("America/Sao_Paulo");
    expect(resolveTimeZone("")).toBe("America/Sao_Paulo");
    expect(resolveTimeZone("Marte/Centro")).toBe("America/Sao_Paulo");
    expect(resolveTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
  });
});

describe("dayKeyFromDateColumn", () => {
  it("extrai o dia gravado de coluna DATE sem reconverter pelo fuso", () => {
    // Meia-noite UTC é artefato do tipo DATE: em São Paulo seria 21:00 do dia
    // anterior — reconverter deslocava feedbacks/calendário um dia para trás.
    expect(dayKeyFromDateColumn("2026-09-03T00:00:00+00:00", "America/Sao_Paulo")).toBe("2026-09-03");
  });

  it("aceita a chave pura e converte apenas instants de verdade", () => {
    expect(dayKeyFromDateColumn("2026-09-03", "America/Sao_Paulo")).toBe("2026-09-03");
    expect(dayKeyFromDateColumn("2026-09-03T01:00:00Z", "America/Sao_Paulo")).toBe("2026-09-02");
    expect(dayKeyFromDateColumn(undefined)).toBe("");
  });
});
