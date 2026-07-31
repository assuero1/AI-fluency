type SkeletonProps = {
  variant?: "line" | "card" | "circle";
  width?: string | number;
  height?: string | number;
  className?: string;
};

export function Skeleton({ variant = "line", width, height, className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={["skeleton", `skeleton-${variant}`, className].filter(Boolean).join(" ")}
      style={{ width, height }}
    />
  );
}
