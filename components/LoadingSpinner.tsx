type LoadingSpinnerProps = {
  /** Pixel width/height of the spinner ring */
  size?: number;
  className?: string;
  label?: string;
};

export function LoadingSpinner({ size = 20, className = "", label }: LoadingSpinnerProps) {
  const s = `${size}px`;
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} role="status" aria-live="polite">
      <span
        className="shrink-0 animate-spin rounded-full border-2 border-[#4A7FC1] border-t-transparent"
        style={{ width: s, height: s }}
        aria-hidden
      />
      {label ? <span className="text-xs font-medium text-gray-500">{label}</span> : null}
    </span>
  );
}
