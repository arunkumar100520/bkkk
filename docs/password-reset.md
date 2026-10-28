# Password reset

The login modal's **Forgot password?** action implements email → OTP → new password.
All endpoints are public POST requests under `/api/v1`, accept JSON, and return
`Cache-Control: no-store`. They do not log users in automatically.

| Endpoint | JSON request | Success response |
| --- | --- | --- |
| `/forgot-password` | `{ "email": "student@example.com" }` | `{ "success": true, "message": "...", "requestId": "...", "expiresIn": 600, "resendAfter": 60 }` |
| `/verify-reset-otp` | `{ "requestId": "...", "otp": "012345" }` | `{ "success": true, "message": "...", "resetToken": "...", "expiresIn": 600 }` |
| `/reset-password` | `{ "requestId": "...", "resetToken": "...", "newPassword": "...", "confirmPassword": "..." }` | `{ "success": true, "message": "Password updated. Please log in with your new password." }` |

Send OTPs as strings so leading zeros are retained. Keep request IDs and reset
tokens in memory, never URLs or local storage. Validation failures return 400;
rate limits return 429; infrastructure/mail failures return 503. Start again if
the OTP or verified reset session expires. Resending replaces all prior reset
authorization for that account. Unknown email addresses receive the same normal
success response without an email.

## Deployment

- MongoDB (`DB_URI`) and Redis (`REDIS_URL`) must be available.
- Configure `RESEND_API_KEY` and `RESEND_FROM_EMAIL` with a sender on a domain
  verified in Resend. The `onboarding@resend.dev` test sender cannot deliver to
  arbitrary users. Example: `RESEND_FROM_EMAIL="QualtSpire <support@your-domain.com>"`.
- Set a strong random `PASSWORD_RESET_SECRET` (at least 32 random bytes) for OTP
  HMAC hashing. For compatibility, `ACCESS_TOKEN` is used if this is absent.
  Changing this secret invalidates pending OTPs. Never use a frontend/public variable.
- Set `NODE_ENV=production` on Render. If the deployment has exactly one trusted
  reverse proxy before Express, set `TRUST_PROXY_HOPS=1` so per-IP limits see the
  client IP. Otherwise use your actual trusted proxy count; leave unset for direct
  connections. Never blindly trust arbitrary forwarded headers.
- Run `npm run build` for the backend. This compiles TypeScript and copies email
  templates into `build/mails`. Run `npm start` after the build.
- Deploy the frontend with its existing `NEXT_PUBLIC_SERVER_URI` pointing to the
  backend API. Both repositories need deployment for the complete UI flow.

## Protection and checks

Six-digit codes use cryptographic randomness and are stored only as keyed hashes.
Codes expire after 10 minutes and allow at most five wrong attempts. Verified
reset tokens contain 256 random bits, are stored as hashes, and expire after
10 minutes. MongoDB conditional updates enforce single use under concurrency.
Passwords must match, contain at least eight characters, and fit bcrypt's
72-byte input limit. Redis enforces a 60-second resend cooldown, five requests
per email per hour, 20 requests per IP per hour, 60 verification requests per IP
per 15 minutes, and 30 reset requests per IP per 15 minutes.

Password resets increment `tokenVersion`. Access and refresh token validation
checks that version against MongoDB, rejecting all older sessions even after
the user logs in again or a Redis cache deletion fails.

Run `npm test` for isolated controller/security regression tests. These use
in-memory substitutes for MongoDB, Redis and email; they never connect to live
services or send real emails. Verify delivery in staging using an authorized
test account after configuring the verified sender.
