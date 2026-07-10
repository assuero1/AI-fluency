import type { LucideIcon } from "lucide-react";
import { IconBubble } from "./IconBubble";

type Metric = {
  value: string;
  label: string;
  foot?: string;
  icon?: LucideIcon;
  tone?: "primary" | "warning" | "info" | "danger";
};

export function MetricGrid({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="metric-grid">
      {metrics.map((metric) => (
        <div className="metric" key={metric.label}>
          <div className="metric-value">
            {metric.icon ? <IconBubble Icon={metric.icon} tone={metric.tone ?? "primary"} /> : null}
            <span className="metric-number">{metric.value}</span>
          </div>
          <div className="metric-label">{metric.label}</div>
          {metric.foot ? <div className="metric-foot">{metric.foot}</div> : null}
        </div>
      ))}
    </div>
  );
}
