# Demo account access

1. Sign in as the demo administrator, then open Operations.
2. Add and approve an employer or partner.
3. On that organisation’s row, choose **Create / replace invitation** and copy the link. Delivery is simulated; no email or WhatsApp message is sent.
4. Open the link in a private browser window to keep Operations signed in separately. Note the account ID, choose a demo password (10–128 characters), and accept the invitation. The correct dashboard opens.
5. Sign out, then use **Sign in / out** with the account ID and password. Operations can replace an invitation for password recovery. Acceptance invalidates previous account sessions. Links expire after 24 hours and can only be used once.
6. For a returning candidate, use **Sign in / out → Returning job seeker**, the original synthetic mobile number, and simulated code **123456**. The same profile opens; no second profile is created. Use WhatsApp journey to edit profile and role details, Profile & preferences for preferences, and Alerts & messages for offers and requested documents.

Candidate verification and document storage are still demo simulations. Do not enter real identity documents or treat code 123456 as real phone verification. Employer/partner passwords are hashed; suspended organisations cannot sign in or use their protected views/actions. Five incorrect password attempts lock the account for 15 minutes.

Deployment: apply migration 007 using `npm run db:migrate`, then deploy. Keep DEMO_SESSION_SECRET and DEMO_PASSWORD configured. No new external service is required. Do not reset or reseed the database.
