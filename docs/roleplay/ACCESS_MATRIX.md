# Access matrix (spec §3, §18, §23)

Roles come from `rp.membership`, and team scope from `rp.team_membership`. Every query filters on the actor's `tenant_id`. An object in another tenant, or one the actor may not see, returns **404** with no details, so IDs reveal nothing. A missing role returns **403**.

| Action | learner | manager | author | reviewer | tenant_admin | operator | Enforced in |
|---|---|---|---|---|---|---|---|
| List published scenarios, read brief | ✓ | | | | | | `registry.publicScenarios`, `getBrief` |
| Start / continue / finish / abandon own session | own | | preview only | preview only | | | `sessions.loadSessionFor` (owner) |
| Read own report, start retries | own | | | | | | `evaluation.getReport`, `startRetry` |
| Read a learner's report | | managed team only | | ✓ (for review) | | every learner | `loadSessionFor('owner_or_manager')` |
| Team analytics | | managed teams only | | | | | `analytics.managerAnalytics` |
| Create / edit / validate / submit draft | | | ✓ | validate | | | `registry.*Draft` |
| Publish, reject, retire | | | | ✓, not the submitter* | | | `registry.publishDraft` |
| Review evaluations | | | | ✓, not own session | | | `evaluation.submitReview` |
| Retry failed evaluation | | | | ✓ | ✓ | | `evaluation.retryEvaluation` |
| Allow a graded retake | | managed team only, after all attempts used | | | | | `assessment.grantRetake` |
| See every learner's graded assessments; set attempts allowed | | | | | | ✓ | `assessment.listOperatorAssessments`, `setAssessmentAttempts` |
| Retention purge | | | | | ✓ | | `retention.purgeExpired` |

\* The same person may submit and publish only if the tenant setting `author_reviewer_combined` is true. The synthetic `acme-training` tenant enables it to model a small pilot, and every publication is audited.

**Tested:** AT21 (cross-learner, cross-tenant, cross-team report and analytics), FR10 (author cannot publish), and §3 (learner cannot publish or review; a reviewer cannot review their own session).

**Not in scope here:** SSO/OIDC, membership administration UI, and exports (spec §18 defers exports until retention and access controls are approved).
