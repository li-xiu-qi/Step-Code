/**
 * Login feature slot, mounted by App.tsx last so it covers everything:
 * `LoginGate` (`#loginGate`), the Desktop sign-in shown while `auth.json` has
 * no Step credential. See actions.ts for the host routes it drives.
 */

import "./login.css";

export { LoginGate } from "./LoginGate";
