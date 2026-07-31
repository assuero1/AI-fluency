export function LoadingDots({ srText = "Carregando..." }: { srText?: string }) {
  return (
    <span className="loading-dots" role="status">
      <span className="sr-only">{srText}</span>
      <span aria-hidden="true" className="loading-dot" />
      <span aria-hidden="true" className="loading-dot" />
      <span aria-hidden="true" className="loading-dot" />
    </span>
  );
}
