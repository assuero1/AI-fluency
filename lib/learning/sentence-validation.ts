const CJK_REGEX = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

export function targetOccurrenceCount(sentence: string, target: string) {
  if (!sentence || !target) return 0;
  if (CJK_REGEX.test(sentence) || CJK_REGEX.test(target)) {
    return [...sentence.matchAll(new RegExp(escapeRegExp(target), "giu"))].length;
  }
  return [...sentence.matchAll(new RegExp(`(^|\\s|[.,;:!?¿¡।॥])${escapeRegExp(target)}(?=$|\\s|[.,;:!?¿¡।॥])`, "giu"))].length;
}

export function replaceTargetWithBlank(sentence: string, target: string) {
  if (!sentence || !target) return sentence;
  if (CJK_REGEX.test(sentence) || CJK_REGEX.test(target)) {
    return sentence.replace(new RegExp(escapeRegExp(target), "iu"), "___");
  }
  return sentence.replace(new RegExp(`(^|\\s|[.,;:!?¿¡।॥])${escapeRegExp(target)}(?=$|\\s|[.,;:!?¿¡।॥])`, "iu"), (_match, prefix: string) => `${prefix}___`);
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function countLexicalWords(value: string) {
  if (!value) return 0;
  if (CJK_REGEX.test(value) && typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("ja-JP", { granularity: "word" });
    return [...segmenter.segment(value)].filter((item) => item.isWordLike).length;
  }
  return value.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

export function lexicalTokens(value: string) {
  if (!value) return [];
  if (CJK_REGEX.test(value) && typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("ja-JP", { granularity: "word" });
    return [...segmenter.segment(value)]
      .filter((item) => item.isWordLike)
      .map((item) => item.segment.normalize("NFC"));
  }
  return (value.toLocaleLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []).map((token) => token.normalize("NFC"));
}

export const allowedFunctionWords = new Set(
  ("a an the to of in on at for with and or but i you he she it we they my your his her our their am is are was were be been do does did have has had " +
    "o os as um uma uns umas de da do das dos em no na nos nas para por com e ou mas eu você ele ela nós vocês eles elas meu minha seu sua " +
    "el la los las un una unos unas de del al en por para con y o pero yo tú usted él ella nosotros ustedes ellos ellas mi tu su es son era fue ser estar ha han haber " +
    "du des au aux dans sous chez vers entre avant apres pendant depuis dont quand ce cet cette ces mon ton son notre votre leur " +
    "dello della dei degli delle alla ai agli alle dal dalla nel nella tra fra anche se chi cui questo questa questi queste quello quella quelli quelle " +
    "は が を に で と も へ か から まで より ね よ て た だ です ます " +
    "的 了 在 是 我 你 他 她 它 们 不 和 有 也 都 着 会 到 上 下 这 那 吗 呢 吧 " +
    "का की के में पर से को है हैं था थी थे और या नहीं भी तो ही")
    .split(/\s+/)
    .filter(Boolean)
);
