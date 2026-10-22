// Capture the invitation before React mounts and before controller top-level
// network requests. Keep the existing controller and transaction flow intact.
import {installReferralContext} from './referral-context.js';
installReferralContext(window);
await import('./main.jsx');
