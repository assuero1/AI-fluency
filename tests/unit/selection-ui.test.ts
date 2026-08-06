import { describe, expect, it } from "vitest";
import { resolveSelectionState } from "../../lib/learning/selection-ui";

type FakeNode = { contains: (other: unknown) => boolean };

function fakeNode(contains: (other: unknown) => boolean = () => false): FakeNode {
  return { contains };
}

const insideText = fakeNode();
const chatStack = fakeNode((other) => other !== outsideText);
const explainerButton = fakeNode();
const explainer = fakeNode((other) => other === explainerButton);
const outsideText = fakeNode();

function resolve(overrides: Partial<Parameters<typeof resolveSelectionState>[0]> = {}) {
  return resolveSelectionState({
    text: "palavra selecionada",
    isCollapsed: false,
    rangeCount: 1,
    commonAncestor: insideText as unknown as Node,
    chatStack: chatStack as unknown as Node,
    explainer: explainer as unknown as Node,
    activeElement: null,
    ...overrides
  });
}

describe("resolveSelectionState", () => {
  it("captures a non-collapsed selection inside the chat stack", () => {
    expect(resolve()).toEqual({ action: "capture", text: "palavra selecionada" });
  });

  it("trims the captured text", () => {
    expect(resolve({ text: "  palavra selecionada  " })).toEqual({ action: "capture", text: "palavra selecionada" });
  });

  it("clears when the selection is collapsed", () => {
    expect(resolve({ isCollapsed: true })).toEqual({ action: "clear" });
  });

  it("clears when the selection is empty", () => {
    expect(resolve({ text: "   " })).toEqual({ action: "clear" });
  });

  it("clears when there is no range", () => {
    expect(resolve({ rangeCount: 0, commonAncestor: null })).toEqual({ action: "clear" });
  });

  it("clears when the selection is longer than 300 characters", () => {
    expect(resolve({ text: "a".repeat(301) })).toEqual({ action: "clear" });
  });

  it("clears when the selection is outside the chat stack", () => {
    expect(resolve({ commonAncestor: outsideText as unknown as Node })).toEqual({ action: "clear" });
  });

  it("keeps the panel when the selection collapses while the explainer button is focused", () => {
    expect(resolve({ isCollapsed: true, activeElement: explainerButton as unknown as Element })).toEqual({
      action: "none"
    });
  });

  it("does not capture a selection made inside the explainer itself", () => {
    expect(resolve({ commonAncestor: explainerButton as unknown as Node })).toEqual({ action: "none" });
  });
});
