# Scoring → portal package: local integration contract (DRAFT, not implemented)

Revised 28 October 2026 for internal review. Nothing here is built. No database write, publication or deployment is proposed.
The example is synthetic (the test suite's fictional rubric); it contains no real candidate, client or role.

## 1. Three separate stages

| Stage | What it is | Where it lives | What may be missing |
|---|---|---|---|
| **A. Local draft file** | What the scoring tool can prepare from a recruiter-confirmed client summary, with every unresolved item listed | A private file on this computer only | Anything. Unresolved items are listed, never filled in by guesswork |
| **B. Database-valid draft package** | A draft the portal database accepts (§5) | Would be a `submission_packages` row (state `draft`) plus any `requirement_evidence` rows | Evidence rows may be **missing**. Every row that is included must be complete, and the mapping and `why_shared` must be present. There is no "unresolved" value |
| **C. Complete, client-ready and published** | A package a client can see | `state = 'published'`, through the owner-only `publish_package` | Nothing |

A database-valid draft is not necessarily complete enough to publish. A local draft file is never written to the portal, and it is not a portal package. Moving from A to B, and from B to C, are separate steps, each with its own approval.

**Before anything is marked client-ready or published (stage C):**
1. The assessment rules are approved. Test rules may only ever reach the fictional development database.
2. The client summary is the current one and recruiter-confirmed, with nothing marked out of date or held for review.
3. There is a current recruiter decision of **Put forward to the client**, not marked out of date. While an essential requirement is Not met, the candidate cannot be put forward, so the package cannot become client-ready. The tool has no way to record a client exception.
4. Every mapping is resolved: the candidate to its portal submission, role and client; and every requirement of the role's **agreed** set has exactly one evidence row.
5. Who approved and who published is decided and recorded (D1, D2). The portal records only the publication time.

## 2. Fields

| Scoring (confirmed client summary) | Portal | How |
|---|---|---|
| Shown strengths' text | `strengths[]` | Direct. Held strengths only if a recruiter approved them with a reason. The CV quotes attached to strengths are not carried; portal strengths are text only. |
| Gaps | `points_to_clarify[]` | Direct |
| Strength and gap text | (same) | Passed through the existing client-wording layer. A sentence that becomes "This point needs recruiter review", or text over the portal limit (300 characters, 20 items), stays unresolved. It is never cut. |
| Status and reason per requirement | `requirement_evidence` (`status`, `evidence`, `source_label`) | §4 |
| — | `why_shared` | Written by a recruiter for the client. It is never derived from the summary or from the internal decision reason. |
| — | `key_facts` | Left empty |
| Candidate | `submission_id`, `role_id`, `client_id` | An explicit mapping record. Nothing is matched by name. |

**Never transferred:** ratings, weights, scores, bands, coverage, score limits, routing, screening ratings, AI details, internal decision reasons, and the call summary (the portal's screening summary is a separate decision).

## 3. Requirements: explicit mapping only

- Scoring **importance** (Critical, Important, Nice to have) and the portal's **tier** (Must-have, Preferred) are different things. Neither is derived from the other.
- Each scoring item is mapped by hand to a requirement in the role's **agreed** set, or marked "not shared". The tier is whatever the agreed set already says.
- A scoring item without a mapping is left out of the package and listed. A requirement in the agreed set with no mapped scoring item stays unresolved until a recruiter records evidence for it (§4).
- The mapping is recorded with who made it and when, and it is reused only for the same rules version and the same agreed set.

## 4. Statuses

**Automatic (the only one):** "Not stated" → `not_evidenced`, with the evidence text "The CV does not mention this." and no source.

**Never automatic:** "Needs review", "Claimed · needs checking", "Checked separately" and "Conflicting" stay unresolved. None of them is ever turned into `supported`, `partly_supported` or `confirmed_not_met` by the tool.

**Evidence-based status review (recruiter, explicit):** a recruiter may verify the evidence for one requirement and choose a portal status. The evidence can be what the CV already shows, checked by the recruiter, or information gathered later; new information is not required. The review keeps:
- the original scoring status, reason and quotes, unchanged;
- the chosen portal status, the client-facing evidence text and its source;
- who made the change, when and why.

The tool would refuse `supported` or `partly_supported` without sufficient verified evidence and a source, and would refuse any status for a requirement still marked Conflicting. The review is stored on the scoring side, append-only; the original status, quotes and earlier reviews are never changed. The portal receives only the status, evidence text and source label: it has no fields for who changed a status or why.

An essential requirement that is Not met blocks putting the candidate forward, and so blocks stage C. It does not block preparing an internal local draft (stage A), which lists it as a blocker.

## 5. Checked against the portal schema (migration M3)

- **A draft row** needs a submission, role and client that belong together; a requirement set of the same role (the set may itself be a draft); and a non-empty `why_shared` of up to 2,000 characters. `strengths` and `points_to_clarify` are each limited to 20 items of up to 300 characters, and `key_facts` to 20 label–value pairs. `published_at` must be empty.
- **Evidence rows** may be missing while a package is a draft: the database accepts a draft with some or none of them. Each row present needs one of four statuses (`supported`, `partly_supported`, `not_evidenced`, `confirmed_not_met`), evidence text of 1–1,000 characters, and a source label unless it is `not_evidenced`. A row has no "unresolved" value.
- **Publishing** requires the set to be **agreed** and exactly one evidence row per requirement. After that, the content is frozen.
- **Writes:** only the database owner can write, through the fictional seed route today. There is no staff write path or approval record (P04, D1, D2).

## 6. Synthetic example: an incomplete local draft (stage A)

Candidate S, synthetic role. Recruiter-confirmed summary, revision 2. Current decision: Put forward. Rules: test rules (not approved).

Explicit requirement mapping, made by a recruiter against the synthetic role's agreed set:

| Scoring item | Agreed-set requirement (tier from the set) |
|---|---|
| G1 Synthetic licence | R1 "Valid licence and clean record" (Must-have) |
| G2 Synthetic lifting | not shared (checked through the client's process) |
| C1 Winning synthetic deals | R2 "Track record of winning new business" (Must-have) |
| C2 Synthetic margins | R3 "Margin awareness" (Preferred) |
| I1 Synthetic reporting | **no mapping yet** |
| — | R4 "Comfortable with long field days" (Preferred): **no scoring item** |

One evidence-based status review was recorded: R1, original status "Needs review" (licence stated, clean record not stated). The recruiter saw the licence and a recent driving record during the call and chose `supported`, source "Documents seen by recruiter, 12 Jan 2026", with their name, time and reason kept.

```json
{
  "kind": "local-draft-file (not a portal package)",
  "candidate": "Candidate S", "summaryRevision": 2, "decision": "Put forward (current)",
  "package": {
    "why_shared": null,
    "strengths": ["Counted synthetic deals within a period."],
    "points_to_clarify": ["No margin work is described."],
    "key_facts": []
  },
  "evidence": [
    { "requirement": "R1", "status": "supported", "evidence": "Licence and a recent driving record were seen by the recruiter.",
      "source_label": "Documents seen by recruiter, 12 Jan 2026",
      "review": { "from": "Needs review", "by": "Synthetic recruiter", "at": "2026-01-12T10:00:00Z", "reason": "Both documents were seen in the call." } },
    { "requirement": "R3", "status": "not_evidenced", "evidence": "The CV does not mention margin work.", "source_label": null }
  ],
  "unresolved": [
    "R2: scoring status Needs review (no evidence-based review recorded)",
    "R4: no scoring item; needs recruiter evidence",
    "I1: not mapped to the agreed set",
    "why_shared: not written",
    "portal submission, role and client: not mapped"
  ]
}
```

**Blocks stage B (database-valid draft):** `why_shared` is not written, and the portal submission, role and client are not mapped. R2 and R4 do not block stage B: they would simply have no evidence row yet, so the draft would hold rows for R1 and R3 only.
**Blocks stage C (complete, client-ready and published), additionally:** R2 and R4 still need evidence rows (every agreed requirement needs exactly one); the rules are test rules, not approved; the approver and publisher are not recorded (D1, D2); and applying anything to the database needs its own approval.

## 7. Corrections to the backend inventory (28 October)

- **Read-only preview:** the build is ready and checked locally. Hosted access protection is **not verified**, because nothing has been deployed yet.
- **History:** the hash-chained history **detects** changed, removed or reordered entries against its checkpoint. It is not tamper-proof: someone with file access can rewrite the chain and its checkpoint together.
- **AI testing permission:** Revenue Optics has permission to test the supplied CVs with AI (recorded in the checklist). What remains open is separate: the arrangements for a hosted service, such as a business AI account and its terms, retention, and candidate notices for live use.
