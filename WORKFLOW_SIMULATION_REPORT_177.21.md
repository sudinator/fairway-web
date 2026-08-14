# Workflow Simulation Report — 177.21.260814

## Scenarios modeled
1. Staging build -> branch ref is `staging` -> yellow marker renders; safe-area top is respected.
2. Production build -> branch ref is `main` -> no staging marker renders.
3. Provider result has no canonical BNN match -> provider payload becomes editable course -> normal create flow.
4. Provider result has one canonical match -> stored BNN payload becomes editable primary -> provider payload retained separately.
5. Stored/provider payloads match -> source banner states provider currently matches; no correction implied.
6. Stored/provider payloads differ -> differences are visible -> stored values remain unchanged until explicit review action.
7. User chooses provider review -> editable payload switches to provider copy -> save resolves same canonical UUID and existing correction/reason workflow handles material changes.
8. User leaves/re-enters after provider selection -> local course draft restores both the editable course and its provider/stored provenance context.
9. User never chooses provider review -> save/link uses stored canonical data and cannot create a duplicate canonical row.
10. PWA 177.20 installed -> 177.21 deployed -> expected live test: old shell remains active and update prompt shows new version; user Update activates 177.21.

## Automated model/guard results
- Existing workflow fault simulation: PASS (50,087 checks; 50,000 randomized RSVP operations).
- Course source transparency contract: PASS.
- Staging environment marker contract: PASS.
- Safe-area frame guard: PASS.
- Existing PWA update contract: PASS.

## Limitations
The real PWA transition and Production canonical-course data path require live browser/Production validation after staging/PR gates pass.
