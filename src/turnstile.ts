export type TurnstileInstance = {
  render: (el: HTMLElement, opts: { sitekey: string; callback?: (token: string) => void; "expired-callback"?: () => void; theme?: "light" | "dark" }) => string;
  reset: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileInstance;
  }
}

export function getTurnstile(): TurnstileInstance | null {
  return window.turnstile || null;
}

