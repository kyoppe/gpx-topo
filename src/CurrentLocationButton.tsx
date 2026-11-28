import type { MouseEventHandler } from 'react';

type CurrentLocationButtonProps = {
  active: boolean;
  busy: boolean;
  disabled: boolean;
  label: string;
  clearLabel: string;
  onClick: MouseEventHandler<HTMLButtonElement>;
};

export function CurrentLocationButton({
  active,
  busy,
  disabled,
  label,
  clearLabel,
  onClick,
}: CurrentLocationButtonProps) {
  return (
    <button
      type="button"
      className="map-location-button"
      data-piece="content"
      data-map-control=""
      data-latched={active ? '' : undefined}
      drawable=""
      aria-label={active ? clearLabel : label}
      aria-pressed={active}
      aria-busy={busy}
      disabled={disabled}
      onClick={onClick}
    >
      <svg className="location-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="6.8" />
        <circle cx="12" cy="12" r="2.2" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      </svg>
    </button>
  );
}
