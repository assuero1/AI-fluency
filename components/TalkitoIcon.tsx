import React from "react";

export type TalkitoIconName =
  | "streak-flame"
  | "trophy"
  | "target"
  | "lightbulb"
  | "brain"
  | "lightning"
  | "party-popper"
  | "teacher-chameleon"
  | "microphone"
  | "listening-bubble"
  | "calendar-desk"
  | "clock-timer"
  | "travel-suitcase"
  | "remote-laptop"
  | "growth-stairs"
  | "badge-essential"
  | "badge-native"
  | "badge-power"
  | "check-stamp"
  | "alert-badge"
  | "lock-gold"
  | "chameleon-standing";

export interface TalkitoIconProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> {
  name: TalkitoIconName;
  size?: number | string;
  className?: string;
  alt?: string;
}

export function TalkitoIcon({
  name,
  size = 24,
  className = "",
  alt = "",
  style,
  ...rest
}: TalkitoIconProps) {
  const pixelSize = typeof size === "number" ? `${size}px` : size;

  return (
    <img
      src={`/assets/icons/talkito/${name}.png`}
      alt={alt}
      aria-hidden={alt === "" ? true : undefined}
      width={typeof size === "number" ? size : undefined}
      height={typeof size === "number" ? size : undefined}
      style={{
        width: pixelSize,
        height: pixelSize,
        objectFit: "contain",
        display: "inline-block",
        verticalAlign: "middle",
        flexShrink: 0,
        ...style,
      }}
      className={`talkito-icon ${className}`.trim()}
      loading="lazy"
      decoding="async"
      {...rest}
    />
  );
}
