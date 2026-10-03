import type en from "../en/activity";
export default {
  "m.activity.title": "गतिविधि",
  "m.activity.pending": "जारी है",
  "m.activity.failed": "पूरा नहीं हुआ — कुछ भी नहीं कटा",
  "m.activity.empty": "अभी कोई गतिविधि नहीं",
  "m.activity.legDetail": "{network} · {hash}",
} satisfies Record<keyof typeof en, string>;
