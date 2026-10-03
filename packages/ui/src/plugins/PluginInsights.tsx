import { Card, Chip } from "../components";
import { IconAlert } from "../components/icons";
import type { PluginInsightView } from "./client";

/**
 * Plugin notes on an approval. Each plugin gets its own card titled "From <plugin>", marked as not checked by
 * the wallet, below the wallet's own lines and warnings. Plugins can add, never remove or edit.
 */
export function PluginInsights(props: { insights?: PluginInsightView[] }) {
  const list = props.insights ?? [];
  if (!list.length) return null;
  return (
    <section aria-label="Notes from plugins" data-testid="plugin-insights">
      {list.map((i) => (
        <Card key={i.pluginId}>
          <div className="clip-row">
            <span className="clip-row__label">
              <strong>From {i.pluginName}</strong> <Chip tone="muted">Plugin</Chip>
            </span>
          </div>
          {i.warnings.map((w, k) => (
            <div key={`w${k}`} className={`clip-notice clip-notice--${w.level}`} role="status">
              <IconAlert />
              <span>{w.message}</span>
            </div>
          ))}
          {i.lines.map((l, k) => (
            <div key={`l${k}`} className="clip-row">
              <span className="clip-row__label">{l.label}</span>
              <span className="clip-row__value">{l.value}</span>
            </div>
          ))}
          <p className="clip-hint">Added by the {i.pluginName} plugin, not checked by Clip Wallet.</p>
        </Card>
      ))}
    </section>
  );
}
