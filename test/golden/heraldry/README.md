# Heraldry goldens

Seven renders promoted out of work unit 2's probe by review, because they are the evidence its verdict is bound to — `docs/work/2_heraldry-legibility/plan.md` records the sha256 of each, and the review is bound to those bytes rather than to the claim.

They live here rather than under `docs/work/` because the fleet work-document contract keeps binaries out of a work unit: an artifact review promotes becomes a repository input — a fixture, golden, snapshot or contract — and takes a normal tracked path. These are goldens.

They are also the seed for the screenshot-regression gate `ARCHITECTURE.md` plans. Regenerate with `npm run probe:heraldry`. **A regenerated file strands its review rather than inheriting it**: if the bytes change, the digests in `plan.md` no longer match and the verdict has to be re-established by looking, not by assuming.
