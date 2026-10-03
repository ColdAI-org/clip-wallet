import type en from "../en/approvals";
export default {
  "approvals.empty": "आपके लिए कुछ भी बाकी नहीं है",
  "approvals.position": "{n, plural, one {# रिक्वेस्ट} other {# रिक्वेस्ट}} में से 1",
} satisfies Record<keyof typeof en, string>;
