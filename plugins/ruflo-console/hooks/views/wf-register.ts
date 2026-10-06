/**
 * The one file the merge owner edits to switch a Workflows slot on (ADR-464): each feature that registers slots
 * (views/wf-slots.ts) is imported here for its side effect, one line apiece, e.g.
 *
 *   import '../wf-drill'
 *
 * Nothing is imported yet: the page draws exactly the board until a feature module is added below.
 */
export {}
