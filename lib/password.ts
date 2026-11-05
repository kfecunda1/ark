// Used by the Settings → Users "Generate" button (components/settings/
// users-section.tsx) to fill a temporary password before Add User /
// Reset Password is submitted. Pure and isomorphic — `crypto` is the
// same Web Crypto global in both the browser and the Next.js server
// runtime, so this works wherever it's called from, but it's only ever
// actually called client-side (the button needs the value to display
// it).
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*";

export const TEMP_PASSWORD_LENGTH = 20;

export function generateTemporaryPassword(length: number = TEMP_PASSWORD_LENGTH): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CHARS[b % CHARS.length]).join("");
}
