import { describe, expect, it } from "vitest";
import { paginateSlice, WORDS_PAGE_SIZE } from "../../lib/learning/pagination";

describe("paginateSlice", () => {
  const items = Array.from({ length: 45 }, (_, index) => index + 1);

  it("retorna a primeira página com 20 itens", () => {
    const result = paginateSlice(items, 1);
    expect(result.pageItems).toHaveLength(WORDS_PAGE_SIZE);
    expect(result.pageItems[0]).toBe(1);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(3);
    expect(result.totalItems).toBe(45);
  });

  it("retorna a última página parcial", () => {
    expect(paginateSlice(items, 3).pageItems).toEqual([41, 42, 43, 44, 45]);
  });

  it("limita páginas abaixo de 1 e acima do total", () => {
    expect(paginateSlice(items, 0).page).toBe(1);
    expect(paginateSlice(items, 99).page).toBe(3);
    expect(paginateSlice(items, Number.NaN).page).toBe(1);
  });

  it("lida com lista vazia", () => {
    const result = paginateSlice([] as number[], 5);
    expect(result.pageItems).toEqual([]);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.totalItems).toBe(0);
  });
});
