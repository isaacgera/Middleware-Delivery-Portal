# MDP Phase-1 SPEC Review — Stage 12 (12.1)

- **Date:** 2026-11-05
- **Reviewer:** Spec Reviewer agent (read-only), over SPEC-requirements / SPEC-design / SPEC-tasks.
- **Verdict:** Coverage strong; what's shipped is sound (data model, snapshot-on-add, RBAC, audit,
  integer-pence money all trace correctly). All findings were **documentation drift** — the specs
  lagged the Stage 7–11 reality — not code defects.

## Findings and resolution (all fixed 2026-11-05)

### Blockers
1. **R7.1 PDF contradiction** — req said server-side pdfmake; reality is client-side vendored jsPDF.
   → **Fixed:** rewrote Module 7 (R7.1–R7.4) + the §5.1 scope line with a Stage-7 amendment note.
2. **Design §1/§2 described the parked npm stack as live** (React/Vite/Fastify/Prisma).
   → **Fixed:** §2 table rebuilt as two columns — "Live build (Track 1 — ships)" vs "Parked target
   (Track 2)"; intro paragraph added.
3. **Architecture diagram showed the parked stack.**
   → **Fixed:** §1 now has a live Track-1 diagram (node:http / node:sqlite / vanilla JS / client-side
   jsPDF + metadata-only server record), with a note pointing to Track 2.

### Should-fix
4. **Design §8 stale framing** → tightened to the two-track model (Track 1 SQLite-in-prod; Track 2
   Prisma/Postgres parked); the "SQLite-green ≠ prod-green" discipline now scoped to Track 2 only.
5. **R4.2 missing CANCELLED/ARCHIVED** → added both (ARCHIVED separate/reversible; CANCELLED guarded).
6. **NFR12 no acceptance criterion** → added a concrete criterion (lossless backup+restore round-trip)
   and recorded it as MET (backup-db.mjs + tested restore, DEPLOYMENT.md §5).
7. **NFR1 Entra deferral not documented** → NFR1 now states the OIDC provider is explicitly deferred
   (task 2.7), seam present, not part of sign-off.

### Nice-to-have
8. **R7.2 stale sections** → updated to the Stage-7 refined PDF content.
9. **Future-build requirement placeholders** → covered by the existing tracked tasks 9.11 (import) +
   9.12 (on-screen Menu Card creation); noted rather than adding speculative requirement IDs.
10. **Design §0.1 not reflected in requirements** → the Menu Card lifecycle softening (reactivate /
    guarded delete / metadata-edit) is captured in R2.5–R2.7 context + design §0.1; left as-is
    (design is the right home for the refinement detail).

### Also corrected while in there (stale assumptions)
- **A3** rewritten: SQLite in dev AND prod (Stage 11), Postgres/SQL Server = parked Track 2.
- **A4/A5** rewritten: live build runs on the Node runtime alone (no Vite/Fastify/npm); npm noted as
  needed only to revive Track 2.
- "Last updated" bumped on both requirements and design docs.

## Outcome
Trilogy now aligns with shipped reality across all three docs. No code changes were needed or made.
The remaining Stage-12 gates (12.2 e2e on the deployed app, 12.4 Isaac sign-off → Built) stay with
the BT deployment.

---
*Saved by Forjé from the Spec Reviewer output; fixes applied by Forjé. Read-only review — the agent
changed no files.*
