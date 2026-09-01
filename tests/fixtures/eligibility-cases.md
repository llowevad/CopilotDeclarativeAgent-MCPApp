# Eligibility fixtures for manual Copilot verification

Use these in Phase 3 against real Copilot. The widget should submit the exact stored values shown below; the agent must call `get_eligibility_criteria` before assessing.

## Neighborhood Food Resilience Microgrant — clearly eligible

Answers:
- `food-applicant-type`: `nonprofit` (Nonprofit organization)
- `food-service-area`: `low-access-neighborhood` (A documented low-access neighborhood)
- `food-request-amount`: `20000`
- `food-project-type`: `mobile-pantry` (Mobile pantry or fresh food distribution)
- `food-pantry-partner`: `true`
- `food-matching-funds`: `3000`
- `food-launch-readiness`: `within-30-days`

Expected criteria results:
- Pass `food-rule-applicant-type`.
- Pass `food-rule-service-area`.
- Pass `food-rule-request-cap`.
- Pass `food-rule-project-type`.
- `food-rule-garden-site` is not applicable.
- Pass soft-advisory `food-rule-pantry-partner`.
- Pass soft-advisory `food-rule-match`.

Expected remediation text: none required. Agent should use the positive wording "appears eligible based on your answers" without guaranteeing an award.

## Neighborhood Food Resilience Microgrant — clearly ineligible, request exceeds cap

Answers:
- `food-applicant-type`: `nonprofit` (Nonprofit organization)
- `food-service-area`: `low-access-neighborhood` (A documented low-access neighborhood)
- `food-request-amount`: `25001`
- `food-project-type`: `mobile-pantry` (Mobile pantry or fresh food distribution)
- `food-pantry-partner`: `true`
- `food-matching-funds`: `3000`
- `food-launch-readiness`: `within-30-days`

Expected criteria results:
- Pass `food-rule-applicant-type`.
- Pass `food-rule-service-area`.
- Fail hard-disqualifier `food-rule-request-cap` because `25001` is greater than `25000`.
- Pass `food-rule-project-type`.
- `food-rule-garden-site` is not applicable.
- Pass soft-advisory `food-rule-pantry-partner`.
- Pass soft-advisory `food-rule-match`.

Remediation the agent should surface: "Reduce the grant request to 25000 USD or less, or split costs so only eligible expenses are requested from this fund."

## Rural Clinic Digital Access Grant — clearly eligible

Answers:
- `clinic-applicant-type`: `independent-rural-clinic` (Independent rural clinic)
- `clinic-service-county`: `rural` (Rural county)
- `clinic-project-focus`: `telehealth-equipment` (Telehealth exam equipment)
- `clinic-annual-patients`: `250`
- `clinic-local-match`: `6000`
- `clinic-implementation-timeline`: `within-60-days`
- `clinic-privacy-attestation`: `true`

Expected criteria results:
- Pass `clinic-rule-applicant-type`.
- Pass `clinic-rule-geography`.
- Pass `clinic-rule-focus`.
- Pass `clinic-rule-patient-volume`.
- `clinic-rule-broadband-readiness` is not applicable.
- Pass `clinic-rule-privacy`.
- Pass soft-advisory `clinic-rule-local-match`.

Expected remediation text: none required. Agent should use the positive wording "appears eligible based on your answers" without guaranteeing an award.

## Rural Clinic Digital Access Grant — clearly ineligible, privacy attestation missing

Answers:
- `clinic-applicant-type`: `independent-rural-clinic` (Independent rural clinic)
- `clinic-service-county`: `rural` (Rural county)
- `clinic-project-focus`: `telehealth-equipment` (Telehealth exam equipment)
- `clinic-annual-patients`: `250`
- `clinic-local-match`: `6000`
- `clinic-implementation-timeline`: `within-60-days`
- `clinic-privacy-attestation`: `false`

Expected criteria results:
- Pass `clinic-rule-applicant-type`.
- Pass `clinic-rule-geography`.
- Pass `clinic-rule-focus`.
- Pass `clinic-rule-patient-volume`.
- `clinic-rule-broadband-readiness` is not applicable.
- Fail hard-disqualifier `clinic-rule-privacy` because the submitted value is `false`.
- Pass soft-advisory `clinic-rule-local-match`.

Remediation the agent should surface: "Complete and document privacy policies, role-based access controls, and staff training before using grant-funded telehealth or network systems."
