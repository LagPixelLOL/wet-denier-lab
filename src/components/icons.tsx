// Inline SVG icons for the toolbar buttons.

export function PhotoIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path
        d="M4.5 8.2h3l1.4-2.2h6.2l1.4 2.2h3a1 1 0 0 1 1 1v8.6a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V9.2a1 1 0 0 1 1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13.2" r="3.3" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

export function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 11v5.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="12" cy="7.9" r="1.15" fill="currentColor" />
    </svg>
  );
}

export function SoundIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" />
      <path
        className="wave"
        d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.6a7.6 7.6 0 0 1 0 10.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path className="mute" d="M15.5 9.5l5 5m0-5l-5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M7 7l10 10M17 7L7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function WaterIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 3.5c3 4.1 5 6.9 5 9.6a5 5 0 0 1-10 0c0-2.7 2-5.5 5-9.6z" fill="currentColor" />
      <path className="glint" d="M10 14.2a2.2 2.2 0 0 0 2 2" fill="none" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function OrbitIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path
        d="M12 4.5a7.5 7.5 0 1 1-7.1 5.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M3.6 5.6l1.4 4.3 4.2-1.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
    </svg>
  );
}

export function BucketIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path
        d="M4 18.5c2.6 1.4 13.4 1.4 16 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M7.6 16.2c-.9-2.4-.2-4.6 1.5-6M16.4 16.2c.9-2.4.2-4.6-1.5-6M12 15.6V11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="12" cy="7" r="1.7" fill="currentColor" />
      <circle cx="7" cy="7.6" r="1.15" fill="currentColor" />
      <circle cx="17" cy="7.6" r="1.15" fill="currentColor" />
    </svg>
  );
}

export function RainIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path
        d="M7 13.5h9.5a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6 1.3A2.9 2.9 0 0 0 7 13.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 16.5l-1 2.5M12.5 16.5l-1 2.5M16.5 16.5l-1 2.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SlowIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="13" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 13V9M10 3.5h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function DryIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path
        d="M5 17.5c3-1 5-3.5 6-7m2 9c2.5-1.5 4.5-4.5 5-8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M15.5 3.8l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8zM6.5 6l.5 1.1 1.1.5-1.1.5-.5 1.1-.5-1.1L4.9 7.6 6 7.1z"
        fill="currentColor"
      />
    </svg>
  );
}

export function SceneIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <rect x="3.5" y="5" width="17" height="14" rx="2.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M4 16.2l4.6-4.7 3.6 3.4 2.6-2.4 5.2 4.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx="15.6" cy="9.4" r="1.5" fill="currentColor" />
    </svg>
  );
}

export function WardrobeIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path
        d="M12 8.4V7.2a2.1 2.1 0 1 0-2.1-2.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M12 8.4l8 6.2a1.4 1.4 0 0 1-.9 2.5H4.9a1.4 1.4 0 0 1-.9-2.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}
