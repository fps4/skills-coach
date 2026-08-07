---
title: A block may be owned by a learner
status: accepted
date: 2026-08-07
---

# ADR-0015 — A block may be owned by a learner

## Context

A pack was supposed to be the programme: the CEFR ladder and the ramp of dials that climbs it, the
teaching method, the error-category vocabulary, the goal every brief is written against
([ADR-0008](0008-a-packs-manifest-is-product.md)). None of that is about a person.

But blocks were keyed `(packId, order)`, so every learner working a pack got the same lessons — and
lessons are written around one person's actual work. The domain was therefore in the pack after all,
not declared anywhere, arriving implicitly through whoever the pack's first learner happened to be.
`dutch-conversation-nl` is nominally a Dutch B1→B2 conversation programme and is in practice a Dutch
B1→B2 conversation programme *about integration architecture*.

The cost showed up the first time a second person needed the same programme. Giving them lessons
about their own work — retail leadership and training design — meant forking the entire manifest:
fifteen error-category ids, a sixty-line teaching method and three ramp rungs copied to change
nothing but the subject matter of the prose. A third learner would mean a third copy. And an error
category is the join key for the whole adaptation loop, so renaming one would then have to land in
every copy or silently orphan history in the ones it missed — the exact failure ADR-0008 committed
the manifest to git to prevent.

ADR-0008 anticipated this and deferred it: *"Not decided here. Whether a manifest can be a template
other packs inherit from. With one real pack there is nothing to inherit; the manifest is the
template, copied. Revisit if a second variant of the same program appears."*

## Decision

**A block may carry a `learnerId`.** Absent, the pack owns it and everyone working the pack gets it —
which is what a demo or template pack publishes. Present, it was written around one person's working
world and only they ever see it.

**The domain it is written about lives on the learner**, as a `profile` on the `learners` document:
domain, background, target role, register, what to avoid. Free text throughout, carried into the
brief beside the pack's `method` and interpreted by neither the runtime nor anything else
([ADR-0001](0001-runtime-not-agent.md)). The pack says how hard the next block should be and how it
should be built; the profile says what it should be about.

Five rules make that safe:

1. **Ownership is a field, never an identifier rewrite.** Lesson, drill-item, submission and review
   identifiers all derive from a block id, so re-keying a block would orphan every streak hanging
   off it. `publishBlock` reuses whatever `_id` a block already has and mints a namespaced one only
   for a block that does not exist yet. Blocks published before ownership keep their unnamespaced
   ids forever, and the migration that gave them an owner touched no id at all.
2. **New ids are namespaced by owner, and deterministic.** `blockIdFor` hashes the owner in, exactly
   as `drillIdFor` already did ([ADR-0012](0012-a-learner-may-add-to-their-own-deck.md)), so two
   learners each have their own block 1 and republishing one updates it in place. The owner is
   hashed rather than embedded: the id travels in URLs and does not need to name anybody.
3. **Reads must ask for an owner.** `listBlocks` returns pack-wide blocks plus *this* learner's;
   omitting the id yields pack content only. The safe thing is the default.
4. **Ownership is checked on the way in, not just on the way out.** Fetching another learner's block
   or lesson by guessing its id is a `404`, and so is submitting work against one — otherwise the
   evidence would land in somebody else's error log. Whether it exists is not the caller's business.
5. **Provenance is separate from visibility.** `learnerId` on a drill item used to mean both "whose
   it is" and "not pack content, so the sweep must not touch it". Inside an owned block the
   published items carry a `learnerId` too, so those two questions came apart: a new `origin` field
   answers the second. The publish sweep matches `origin: 'pack'`, and the list of a learner's own
   words matches `origin: 'learner'` — without which a learner would be offered the delete button on
   their own curriculum. Documents written before the field derive it from `learnerId`, which
   answered the old question exactly, so nothing needed backfilling.

**The first block gets a brief too.** `get_brief` read *from* a completed block, which left block 1
with nowhere to come from — the one block an author wrote blind, without the goal, the ramp's first
rung, the method or the learner's world in front of them, and the block that sets the tone for every
one after it. `buildFirstBrief` returns the same payload with the evidence half empty.

**The profile is not identity.** Identity-service owns who someone is
([ADR-0002](0002-identity-service-as-authentication-engine.md)), and the learner record stayed
deliberately thin on that basis. This widens it, knowingly: what a person does all day is not
something an authentication engine has any reason to hold, and an author cannot write a lesson
without it. Writing one is gated on `pack:publish` rather than a capability of its own, because it
is authoring context and carries exactly the authority of publishing the blocks written from it.

## Consequences

**Good.** A pack is now what it always claimed to be — the methodology, and nothing about a person.
Adding a learner is a profile and a publish, not a copied manifest, so the error-category vocabulary
the whole adaptation loop joins on exists once and is reviewed once. The domain became explicit and
editable instead of implicit in whoever came first; a learner can read and correct their own. And
block 1 stopped being the one block written without a brief.

**Costs.** Two ownership concepts now sit on `drillItems` where one used to, and the pair has to be
reasoned about together — the `origin` fallback is the price of not rewriting history. The unique
index moved from `(packId, order)` to `(packId, learnerId, order)`, which is the first index this
codebase has had to drop and recreate rather than simply declare. A block's id no longer tells you
from its shape whether it is owned, because the ones published before this are not namespaced.
And "which learner is this brief about" is now load-bearing in more places, where before a pack with
one learner made the question answer itself.

**Not decided here.** Whether a pack should be able to *require* an owner — refusing a pack-wide
block for a programme that is only ever taught one-to-one. The demo pack needs pack-wide blocks, so
optional is right today; a manifest flag would be the obvious way if it ever stops being.
