import React from "react";

export type TalkitoIconName =
  // 2D Cel-shaded Illustrative Icons (PNG)
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
  | "chameleon-standing"
  | "book-open"
  | "speech-bubble"
  | "bot-chameleon"
  | "user-round"
  | "users"
  | "sparkles"
  // 2D Cel-shaded Vector Action & Utility Icons (Inline SVG)
  | "chevron-left"
  | "chevron-right"
  | "chevron-down"
  | "arrow-right"
  | "play"
  | "pause"
  | "volume"
  | "skip-back"
  | "skip-forward"
  | "rotate-ccw"
  | "send"
  | "close-x"
  | "search"
  | "copy"
  | "trash"
  | "bell"
  | "key"
  | "server"
  | "log-out"
  | "languages"
  | "wifi-off"
  | "plus"
  | "info"
  | "shield-alert"
  | "download"
  | "mic-off"
  | "shuffle"
  | "refresh"
  | "loader"
  | "edit"
  | "layers";

const PNG_ICONS = new Set<string>([
  "streak-flame",
  "trophy",
  "target",
  "lightbulb",
  "brain",
  "lightning",
  "party-popper",
  "teacher-chameleon",
  "microphone",
  "listening-bubble",
  "calendar-desk",
  "clock-timer",
  "travel-suitcase",
  "remote-laptop",
  "growth-stairs",
  "badge-essential",
  "badge-native",
  "badge-power",
  "check-stamp",
  "alert-badge",
  "lock-gold",
  "chameleon-standing",
  "book-open",
  "speech-bubble",
  "bot-chameleon",
  "user-round",
  "users",
  "sparkles"
]);

export interface TalkitoIconProps extends React.HTMLAttributes<HTMLElement> {
  name: TalkitoIconName;
  size?: number | string;
  className?: string;
  alt?: string;
  strokeWidth?: number | string;
}

export function TalkitoIcon({
  name,
  size = 24,
  className = "",
  alt = "",
  strokeWidth,
  style,
  ...rest
}: TalkitoIconProps) {
  const pixelSize = typeof size === "number" ? `${size}px` : size;

  if (PNG_ICONS.has(name)) {
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
        {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)}
      />
    );
  }

  // Cel-shaded SVG Icons
  const isLoader = name === "loader";
  const sw = strokeWidth ? Number(strokeWidth) : undefined;

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      aria-hidden={alt === "" ? true : undefined}
      style={{
        width: pixelSize,
        height: pixelSize,
        display: "inline-block",
        verticalAlign: "middle",
        flexShrink: 0,
        animation: isLoader ? "spin 0.85s linear infinite" : undefined,
        ...style,
      }}
      className={`talkito-icon talkito-svg ${className}`.trim()}
      {...(rest as React.SVGAttributes<SVGSVGElement>)}
    >
      {renderSvgContent(name, sw)}
    </svg>
  );
}

function renderSvgContent(name: TalkitoIconName, strokeWidth?: number) {
  switch (name) {
    case "chevron-left":
      return (
        <path
          d="M15 19L8 12L15 5"
          stroke="currentColor"
          strokeWidth={strokeWidth ?? 3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "chevron-right":
      return (
        <path
          d="M9 5L16 12L9 19"
          stroke="currentColor"
          strokeWidth={strokeWidth ?? 3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "chevron-down":
      return (
        <path
          d="M6 9L12 15L18 9"
          stroke="currentColor"
          strokeWidth={strokeWidth ?? 3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "arrow-right":
      return (
        <path
          d="M4 12H20M20 12L13 5M20 12L13 19"
          stroke="currentColor"
          strokeWidth={strokeWidth ?? 2.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "play":
      return (
        <>
          <polygon
            points="6,4 20,12 6,20"
            fill="#6ec41a"
            stroke="#143823"
            strokeWidth={strokeWidth ?? 2.5}
            strokeLinejoin="round"
          />
          <polygon points="7.5,7 15,12 7.5,17" fill="#a6eb34" opacity="0.75" />
        </>
      );
    case "pause":
      return (
        <>
          <rect
            x="6"
            y="4"
            width="4"
            height="16"
            rx="2"
            fill="#6ec41a"
            stroke="#143823"
            strokeWidth={strokeWidth ?? 2.5}
          />
          <rect
            x="14"
            y="4"
            width="4"
            height="16"
            rx="2"
            fill="#6ec41a"
            stroke="#143823"
            strokeWidth={strokeWidth ?? 2.5}
          />
          <line x1="7.5" y1="6" x2="7.5" y2="14" stroke="#a6eb34" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="15.5" y1="6" x2="15.5" y2="14" stroke="#a6eb34" strokeWidth="1.5" strokeLinecap="round" />
        </>
      );
    case "volume":
      return (
        <>
          <path
            d="M11 5L6 9H3C2.45 9 2 9.45 2 10V14C2 14.55 2.45 15 3 15H6L11 19V5Z"
            fill="#6ec41a"
            stroke="#143823"
            strokeWidth={strokeWidth ?? 2.5}
            strokeLinejoin="round"
          />
          <path
            d="M15.5 8.5C16.8 9.8 17.5 10.9 17.5 12C17.5 13.1 16.8 14.2 15.5 15.5"
            stroke="#143823"
            strokeWidth={strokeWidth ?? 2.5}
            strokeLinecap="round"
          />
          <path
            d="M19 5C21 7.2 22 9.5 22 12C22 14.5 21 16.8 19 19"
            stroke="#143823"
            strokeWidth={strokeWidth ?? 2.5}
            strokeLinecap="round"
          />
        </>
      );
    case "skip-back":
      return (
        <>
          <polygon
            points="19,20 9,12 19,4"
            fill="#6ec41a"
            stroke="#143823"
            strokeWidth={strokeWidth ?? 2.5}
            strokeLinejoin="round"
          />
          <line x1="5" y1="4" x2="5" y2="20" stroke="#143823" strokeWidth={strokeWidth ?? 2.5} strokeLinecap="round" />
        </>
      );
    case "skip-forward":
      return (
        <>
          <polygon
            points="5,4 15,12 5,20"
            fill="#6ec41a"
            stroke="#143823"
            strokeWidth={strokeWidth ?? 2.5}
            strokeLinejoin="round"
          />
          <line x1="19" y1="4" x2="19" y2="20" stroke="#143823" strokeWidth={strokeWidth ?? 2.5} strokeLinecap="round" />
        </>
      );
    case "rotate-ccw":
      return (
        <>
          <path
            d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
            stroke="#143823"
            strokeWidth={strokeWidth ?? 2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M3 3v5h5"
            stroke="#143823"
            strokeWidth={strokeWidth ?? 2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    case "send":
      return (
        <>
          <path
            d="M22 2L11 13"
            stroke="#143823"
            strokeWidth={strokeWidth ?? 2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M22 2L15 22L11 13L2 9L22 2Z"
            fill="#6ec41a"
            stroke="#143823"
            strokeWidth={strokeWidth ?? 2.5}
            strokeLinejoin="round"
          />
          <path d="M20 5L12 12L14.5 18L20 5Z" fill="#a6eb34" opacity="0.6" />
        </>
      );
    case "close-x":
      return (
        <>
          <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth={strokeWidth ?? 3} strokeLinecap="round" />
          <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth={strokeWidth ?? 3} strokeLinecap="round" />
        </>
      );
    case "search":
      return (
        <>
          <circle cx="11" cy="11" r="7" fill="#e8f5e9" stroke="#143823" strokeWidth={strokeWidth ?? 2.6} />
          <circle cx="9" cy="9" r="2.5" fill="#a6eb34" opacity="0.75" />
          <line x1="16.5" y1="16.5" x2="22" y2="22" stroke="#143823" strokeWidth={strokeWidth ?? 3} strokeLinecap="round" />
        </>
      );
    case "copy":
      return (
        <>
          <rect
            x="8"
            y="8"
            width="13"
            height="13"
            rx="2.5"
            fill="#6ec41a"
            stroke="#143823"
            strokeWidth={strokeWidth ?? 2.5}
          />
          <path
            d="M5 16H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1"
            stroke="#143823"
            strokeWidth={strokeWidth ?? 2.5}
            strokeLinecap="round"
          />
        </>
      );
    case "trash":
      return (
        <>
          <path d="M3 6h18" stroke="#ef4444" strokeWidth={strokeWidth ?? 2.5} strokeLinecap="round" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="#ef4444" strokeWidth={strokeWidth ?? 2.5} />
          <path
            d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"
            fill="#fee2e2"
            stroke="#ef4444"
            strokeWidth={strokeWidth ?? 2.5}
            strokeLinejoin="round"
          />
          <line x1="10" y1="11" x2="10" y2="17" stroke="#ef4444" strokeWidth={strokeWidth ?? 2.2} strokeLinecap="round" />
          <line x1="14" y1="11" x2="14" y2="17" stroke="#ef4444" strokeWidth={strokeWidth ?? 2.2} strokeLinecap="round" />
        </>
      );
    case "bell":
      return (
        <>
          <path
            d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"
            fill="#ffb800"
            stroke="#143823"
            strokeWidth={strokeWidth ?? 2.5}
            strokeLinejoin="round"
          />
          <path
            d="M13.73 21a2 2 0 0 1-3.46 0"
            stroke="#143823"
            strokeWidth={strokeWidth ?? 2.5}
            strokeLinecap="round"
          />
          <circle cx="12" cy="7" r="1.5" fill="#fff" opacity="0.8" />
        </>
      );
    case "key":
      return (
        <>
          <circle cx="7.5" cy="15.5" r="5.5" fill="#ffb800" stroke="#143823" strokeWidth={strokeWidth ?? 2.5} />
          <circle cx="7.5" cy="15.5" r="2" fill="#ffffff" stroke="#143823" strokeWidth="1.5" />
          <path d="m11.5 11.5 8.5-8.5" stroke="#143823" strokeWidth={strokeWidth ?? 2.6} strokeLinecap="round" />
          <path d="m18 5 2 2" stroke="#143823" strokeWidth={strokeWidth ?? 2.5} strokeLinecap="round" />
          <path d="m15 8 2 2" stroke="#143823" strokeWidth={strokeWidth ?? 2.5} strokeLinecap="round" />
        </>
      );
    case "server":
      return (
        <>
          <rect width="20" height="7" x="2" y="3" rx="2" fill="#e8f5e9" stroke="#143823" strokeWidth={strokeWidth ?? 2.5} />
          <rect width="20" height="7" x="2" y="14" rx="2" fill="#e8f5e9" stroke="#143823" strokeWidth={strokeWidth ?? 2.5} />
          <circle cx="6" cy="6.5" r="1.5" fill="#6ec41a" stroke="#143823" strokeWidth="1" />
          <circle cx="6" cy="17.5" r="1.5" fill="#6ec41a" stroke="#143823" strokeWidth="1" />
          <line x1="11" y1="6.5" x2="18" y2="6.5" stroke="#143823" strokeWidth={strokeWidth ?? 2} strokeLinecap="round" />
          <line x1="11" y1="17.5" x2="18" y2="17.5" stroke="#143823" strokeWidth={strokeWidth ?? 2} strokeLinecap="round" />
        </>
      );
    case "log-out":
      return (
        <>
          <path
            d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"
            stroke="currentColor"
            strokeWidth={strokeWidth ?? 2.6}
            strokeLinecap="round"
          />
          <polyline
            points="16 17 21 12 16 7"
            stroke="currentColor"
            strokeWidth={strokeWidth ?? 2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line
            x1="21"
            y1="12"
            x2="9"
            y2="12"
            stroke="currentColor"
            strokeWidth={strokeWidth ?? 2.6}
            strokeLinecap="round"
          />
        </>
      );
    case "languages":
      return (
        <>
          <rect x="2" y="3" width="11" height="11" rx="2.5" fill="#e8f5e9" stroke="#143823" strokeWidth="2.2" />
          <text x="7.5" y="11.5" fontSize="8" fontWeight="900" textAnchor="middle" fill="#143823">A</text>
          <rect x="11" y="10" width="11" height="11" rx="2.5" fill="#6ec41a" stroke="#143823" strokeWidth="2.2" />
          <text x="16.5" y="18.5" fontSize="8" fontWeight="900" textAnchor="middle" fill="#ffffff">文</text>
        </>
      );
    case "wifi-off":
      return (
        <>
          <line x1="2" y1="2" x2="22" y2="22" stroke="#ef4444" strokeWidth={strokeWidth ?? 2.8} strokeLinecap="round" />
          <path d="M8.5 16.5a5 5 0 0 1 7 0" stroke="#143823" strokeWidth={strokeWidth ?? 2.5} strokeLinecap="round" />
          <path d="M5 12.5a10 10 0 0 1 6.5-2.5" stroke="#143823" strokeWidth={strokeWidth ?? 2.5} strokeLinecap="round" />
          <circle cx="12" cy="20" r="1.5" fill="#143823" />
        </>
      );
    case "plus":
      return (
        <>
          <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth={strokeWidth ?? 3} strokeLinecap="round" />
          <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth={strokeWidth ?? 3} strokeLinecap="round" />
        </>
      );
    case "info":
      return (
        <>
          <circle cx="12" cy="12" r="9" fill="#e0f2fe" stroke="#143823" strokeWidth={strokeWidth ?? 2.5} />
          <line x1="12" y1="16" x2="12" y2="11" stroke="#143823" strokeWidth={strokeWidth ?? 2.8} strokeLinecap="round" />
          <circle cx="12" cy="7.5" r="1.2" fill="#143823" />
        </>
      );
    case "shield-alert":
      return (
        <>
          <path
            d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
            fill="#fee2e2"
            stroke="#ef4444"
            strokeWidth={strokeWidth ?? 2.5}
            strokeLinejoin="round"
          />
          <line x1="12" y1="8" x2="12" y2="12" stroke="#ef4444" strokeWidth={strokeWidth ?? 2.5} strokeLinecap="round" />
          <circle cx="12" cy="16" r="1.2" fill="#ef4444" />
        </>
      );
    case "download":
      return (
        <>
          <path
            d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
            stroke="currentColor"
            strokeWidth={strokeWidth ?? 2.5}
            strokeLinecap="round"
          />
          <polyline
            points="7 10 12 15 17 10"
            stroke="currentColor"
            strokeWidth={strokeWidth ?? 2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line
            x1="12"
            y1="15"
            x2="12"
            y2="3"
            stroke="currentColor"
            strokeWidth={strokeWidth ?? 2.5}
            strokeLinecap="round"
          />
        </>
      );
    case "mic-off":
      return (
        <>
          <line x1="2" y1="2" x2="22" y2="22" stroke="#ef4444" strokeWidth={strokeWidth ?? 2.8} strokeLinecap="round" />
          <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" stroke="#143823" strokeWidth={strokeWidth ?? 2.5} strokeLinecap="round" />
          <path d="M5 10v2a7 7 0 0 0 12 5" stroke="#143823" strokeWidth={strokeWidth ?? 2.5} strokeLinecap="round" />
          <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" stroke="#143823" strokeWidth={strokeWidth ?? 2.5} strokeLinecap="round" />
          <path d="M9 9v3a3 3 0 0 0 5.12 2.12" stroke="#143823" strokeWidth={strokeWidth ?? 2.5} strokeLinecap="round" />
          <line x1="12" y1="19" x2="12" y2="22" stroke="#143823" strokeWidth={strokeWidth ?? 2.5} strokeLinecap="round" />
        </>
      );
    case "shuffle":
      return (
        <>
          <path d="M16 3h5v5" stroke="#143823" strokeWidth={strokeWidth ?? 2.5} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 20L21 3" stroke="#143823" strokeWidth={strokeWidth ?? 2.5} strokeLinecap="round" />
          <path d="M21 16v5h-5" stroke="#143823" strokeWidth={strokeWidth ?? 2.5} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M15 15l6 6" stroke="#143823" strokeWidth={strokeWidth ?? 2.5} strokeLinecap="round" />
          <path d="M4 4l5 5" stroke="#143823" strokeWidth={strokeWidth ?? 2.5} strokeLinecap="round" />
        </>
      );
    case "refresh":
      return (
        <>
          <path d="M3 12a9 9 0 0 1 15-6.7L21 8" stroke="#143823" strokeWidth={strokeWidth ?? 2.5} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M21 3v5h-5" stroke="#143823" strokeWidth={strokeWidth ?? 2.5} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M21 12a9 9 0 0 1-15 6.7L3 16" stroke="#143823" strokeWidth={strokeWidth ?? 2.5} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 21v-5h5" stroke="#143823" strokeWidth={strokeWidth ?? 2.5} strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    case "loader":
      return (
        <>
          <circle cx="12" cy="12" r="9" stroke="#dcfce7" strokeWidth={strokeWidth ?? 3} />
          <path d="M12 3a9 9 0 0 1 9 9" stroke="#6ec41a" strokeWidth={strokeWidth ?? 3} strokeLinecap="round" />
          <circle cx="21" cy="12" r="2.2" fill="#ffb800" stroke="#143823" strokeWidth="0.8" />
        </>
      );
    case "edit":
      return (
        <>
          <path d="M12 20h9" stroke="#143823" strokeWidth={strokeWidth ?? 2.5} strokeLinecap="round" />
          <path
            d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"
            fill="#6ec41a"
            stroke="#143823"
            strokeWidth={strokeWidth ?? 2.5}
            strokeLinejoin="round"
          />
          <path d="M15 5l3 3" stroke="#a6eb34" strokeWidth="1.8" strokeLinecap="round" />
        </>
      );
    case "layers":
      return (
        <>
          <polygon
            points="12 2 2 7 12 12 22 7 12 2"
            fill="#6ec41a"
            stroke="#143823"
            strokeWidth={strokeWidth ?? 2.5}
            strokeLinejoin="round"
          />
          <polyline
            points="2 17 12 22 22 17"
            stroke="#143823"
            strokeWidth={strokeWidth ?? 2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points="2 12 12 17 22 12"
            stroke="#143823"
            strokeWidth={strokeWidth ?? 2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    default:
      return null;
  }
}

