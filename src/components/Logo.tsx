export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-label="Translator"
      style={{ flex: "none" }}
    >
      <defs>
        <linearGradient id="t-amber" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f7b13f" />
          <stop offset="100%" stopColor="#ef7f24" />
        </linearGradient>
      </defs>
      {/* 后层蓝色气泡 */}
      <path
        d="M6 8.5A5.5 5.5 0 0 1 11.5 3h13A5.5 5.5 0 0 1 30 8.5v9A5.5 5.5 0 0 1 24.5 23H16l-6 5.5V23h-4A5.5 5.5 0 0 1 0 17.5v-9Z"
        transform="translate(1 1)"
        fill="#3f6fd8"
      />
      <path
        d="M5.5 9.5h13"
        stroke="rgba(255,255,255,0.55)"
        strokeWidth="1.8"
        strokeLinecap="round"
        transform="translate(1 1)"
        fill="none"
      />
      {/* 前层橙色气泡 */}
      <path
        d="M6 8.5A5.5 5.5 0 0 1 11.5 3h13A5.5 5.5 0 0 1 30 8.5v9A5.5 5.5 0 0 1 24.5 23H16l-6 5.5V23h-4A5.5 5.5 0 0 1 0 17.5v-9Z"
        transform="translate(9 12)"
        fill="url(#t-amber)"
      />
      {/* T 与循环箭头 */}
      <path
        d="M14.5 20.5h11M20 20.5v7"
        stroke="#fff"
        strokeWidth="2.1"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M23.5 24.5h3.2a1.9 1.9 0 0 1 0 3.8h-3.2"
        stroke="#fff"
        strokeWidth="1.7"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M22.6 23.1l2-1.6 2 1.6"
        stroke="#fff"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
