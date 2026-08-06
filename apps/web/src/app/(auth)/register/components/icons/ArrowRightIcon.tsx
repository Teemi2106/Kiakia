// components/icons/ArrowRightIcon.tsx
export function ArrowRightIcon({ className = "text-white" }) {
  return (
    <svg
      width="13.33"
      height="13.33"
      viewBox="0 0 16 16"
      fill="none"
      className={className}
    >
      <path
        d="M1 8H15M15 8L8 1M15 8L8 15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
