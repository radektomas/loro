# Word explanations — content status

**Deferred as of 2026-08-24. The app ships without this content, deliberately.**

`batches/` holds hand-authored learner notes (usage, optional grammar note,
register, real example cues) per LEMMA, in en/cs/de/fr. See
`packages/core/src/explanations.ts` for the published shape and
`scripts/lib/explanations.mts` for the batch contract.

## Where it stands

| | |
|---|---|
| lemma universe | 4,703 (from both `data/videos.json` and `data/embedVideos.json` dictionaries) |
| batches needed | 48 (100 lemmas each) |
| batches authored | **2** (`batch-000`, `batch-001`) — both validate |
| published | **no** — `publish-explanations` requires the complete set |

## Why shipping without it is safe

The client treats a missing blob as normal, not as an error:
`apps/mobile/src/platform/explanations.ts` resolves `null` on a 404 (which is
what the pointer returns until the first publish), and
`vocab/WordDetailSheet.tsx` simply omits the explanation section. Everything
else on that sheet — the word, translation, SRS schedule, and the "Hear it in
a video" jump — works with no blob at all.

The blob is served from Supabase Storage, NOT bundled, so the content can be
filled in and published later **without an App Store release**. Devices pick
it up on their next daily pointer check.

## Resuming

Per batch N (0..47):

```sh
node scripts/explanations-context.mts --batch N   # glosses + real cue candidates
# author data/explanations/batches/batch-NNN.json
node scripts/check-explanation-batch.mts --batch N  # must print ok
```

Then, once all 48 exist:

```sh
npm run publish-explanations -- --dry-run   # validates everything, uploads nothing
npm run publish-explanations                # blob, then pointer
```

Resume is by file presence — an authored batch is never redone, and a bad one
is redone by deleting its file. The authoring rules that produced batches 0-1
(what makes a good `usage` note, when `grammar` is worth filling, how examples
must reference real cues) are in the batch contract at the top of
`scripts/lib/explanations.mts` and enforced by the validator.

⚠️ The lemma slice for a batch is derived from the catalog, so **publishing new
videos can change the universe** and invalidate authored batches
(`check-explanation-batch` reports "lemma slice does not match the universe").
Author in one catalog state, or expect to redo affected batches.
