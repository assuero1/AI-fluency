export function AuthMascot({ bubble }: { bubble: string }) {
  return (
    <div className="auth-mascot">
      <div className="auth-mascot-bubble">{bubble}</div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="auth-mascot-img"
        src="/mascot.png"
        alt=""
        width={559}
        height={724}
        loading="eager"
      />
    </div>
  );
}
