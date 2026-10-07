/** Namespace "m.activity" (mobile). */
export default {
  "m.activity.title": "Activity",
  "m.activity.pending": "In progress",
  "m.activity.failed": "Didn't go through — nothing was taken",
  "m.activity.empty": "No activity yet",
  /** Advanced detail of one step: network name and short transaction hash. */
  "m.activity.legDetail": "{network} · {hash}",
} satisfies Record<`m.activity.${string}`, string>;
