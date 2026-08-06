export type SelectionResolution =
  | { action: "capture"; text: string }
  | { action: "clear" }
  | { action: "none" };

export function resolveSelectionState(input: {
  text: string;
  isCollapsed: boolean;
  rangeCount: number;
  commonAncestor: Node | null;
  chatStack: Node | null;
  explainer: Node | null;
  activeElement: Element | null;
}): SelectionResolution {
  const clean = input.text.trim();

  if (input.rangeCount === 0 || input.isCollapsed || !clean) {
    return input.activeElement && input.explainer?.contains(input.activeElement)
      ? { action: "none" }
      : { action: "clear" };
  }

  if (clean.length > 300) return { action: "clear" };

  if (!input.chatStack || !input.commonAncestor || !input.chatStack.contains(input.commonAncestor)) {
    return { action: "clear" };
  }

  if (input.explainer?.contains(input.commonAncestor)) return { action: "none" };

  return { action: "capture", text: clean };
}
