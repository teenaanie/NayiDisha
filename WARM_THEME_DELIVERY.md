# Warm theme and consistent typography

Applied the supplied ivory-and-brown reference across Operations, Employer, Partner, Finance, Platform, sign-in, invitation, and Candidate screens through `src/app/theme.css`.

- Ivory page backgrounds and cards, brown navigation and actions, warm sand accents.
- Neutral cards replace pastel metric fills. Charts use coordinated brown, sand, and ochre shades.
- Success, caution, and failure states retain distinguishable muted semantic colors.
- Arial/Helvetica sans-serif is shared by headings, body text, inputs, IDs, numerical data, and currency amounts. Genuine code blocks retain their code formatting.
- Table data uses 13px, status badges 12px, and phone inputs 16px. Headings and dashboard totals retain intentional hierarchy.
- Removed local tiny-font overrides from audit, payout, rewards, matching, and record data. Currency no longer uses the monospace utility.
- The candidate chat keeps its conversation layout and adopts the same warm palette.

Validation:
- Production build, TypeScript, and whitespace checks passed.
- 65 read-only workspace route/search checks passed.
- Browser inspection confirmed all six Employer metric cards have the same ivory fill.
- Computed styles confirmed employer table IDs and data at 13px in the same font; Finance ledger values and currency also use 13px in that font.
- At 390px width, the candidate journey uses the same font and has no document-level horizontal overflow.

Saved locally; this theme update has not been committed, pushed, or deployed. Existing demo records were not reset or changed.
