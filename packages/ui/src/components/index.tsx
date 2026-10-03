import { useEffect, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import QRCode from "qrcode";
import type { Nft } from "@clip-wallet/core";
import type { Warning } from "@clip-wallet/core";
import { hueFor, proxyMedia } from "../lib/media";
import { useRouter, useUi } from "../context";
import { IconAlert, IconBack, IconClock, IconCompass, IconGear, IconGrid, IconHome } from "./icons";
import { useFeaturesOptional } from "../features/context";

/* ------------------------------------------------------------------ buttons */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "primary",
  block,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; block?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={["clip-btn", `clip-btn--${variant}`, block ? "clip-btn--block" : "", className ?? ""].join(" ").trim()}
    />
  );
}

/* ------------------------------------------------------------------ layout */

export function Screen(props: {
  title?: ReactNode;
  back?: boolean | (() => void);
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  nav?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const onBack = typeof props.back === "function" ? props.back : router.back;
  return (
    <div className={`clip-screen ${props.className ?? ""}`}>
      {(props.title || props.back || props.actions) && (
        <header className="clip-header">
          {props.back ? (
            <button type="button" className="clip-icon-btn" onClick={onBack} aria-label="Back">
              <IconBack />
            </button>
          ) : (
            <span className="clip-header__spacer" />
          )}
          {props.title ? <h1 className="clip-header__title">{props.title}</h1> : <span />}
          <div className="clip-header__actions">{props.actions}</div>
        </header>
      )}
      <main className="clip-content">{props.children}</main>
      {props.footer && <footer className="clip-footer">{props.footer}</footer>}
      {props.nav && <TabBar />}
    </div>
  );
}

export function TabBar() {
  const { path, navigate } = useRouter();
  const features = useFeaturesOptional();
  const items = [
    { to: "/", label: "Home", icon: <IconHome /> },
    { to: "/collectibles", label: "Collectibles", icon: <IconGrid /> },
    // Explore (featured apps) appears when the app was given a features client.
    ...(features ? [{ to: "/explore", label: "Explore", icon: <IconCompass /> }] : []),
    { to: "/activity", label: "Activity", icon: <IconClock /> },
    { to: "/settings", label: "Settings", icon: <IconGear /> },
  ];
  return (
    <nav className="clip-tabbar" aria-label="Main">
      {items.map((it) => {
        const active = it.to === "/" ? path === "/" : path.startsWith(it.to);
        return (
          <button
            key={it.to}
            type="button"
            className={`clip-tabbar__item ${active ? "is-active" : ""}`}
            aria-current={active ? "page" : undefined}
            onClick={() => navigate(it.to, { replace: true })}
          >
            {it.icon}
            <span>{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function Card(props: { children: ReactNode; className?: string }) {
  return <section className={`clip-card ${props.className ?? ""}`}>{props.children}</section>;
}

export function Row(props: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="clip-row">
      <span className="clip-row__label">{props.label}</span>
      <span className="clip-row__value">
        {props.value}
        {props.hint && <span className="clip-row__hint">{props.hint}</span>}
      </span>
    </div>
  );
}

export function Chip(props: { children: ReactNode; tone?: "neutral" | "accent" | "muted"; title?: string; className?: string }) {
  return (
    <span className={`clip-chip clip-chip--${props.tone ?? "neutral"} ${props.className ?? ""}`} title={props.title}>
      {props.children}
    </span>
  );
}

/* ------------------------------------------------------------------ inputs */

export function Field(
  props: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string | null; trailing?: ReactNode },
) {
  const id = useId();
  const { label, hint, error, trailing, ...input } = props;
  return (
    <div className="clip-field">
      <label htmlFor={id} className="clip-field__label">
        {label}
      </label>
      <div className={`clip-field__control ${error ? "has-error" : ""}`}>
        <input id={id} aria-invalid={!!error} aria-describedby={error || hint ? `${id}-d` : undefined} {...input} />
        {trailing}
      </div>
      {(error || hint) && (
        <div id={`${id}-d`} className={error ? "clip-field__error" : "clip-field__hint"} role={error ? "alert" : undefined}>
          {error || hint}
        </div>
      )}
    </div>
  );
}

export function Toggle(props: { label: ReactNode; description?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="clip-toggle">
      <div className="clip-toggle__text">
        <span id={`${id}-l`} className="clip-toggle__label">
          {props.label}
        </span>
        {props.description && <span className="clip-toggle__desc">{props.description}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        aria-labelledby={`${id}-l`}
        disabled={props.disabled}
        className={`clip-switch ${props.checked ? "is-on" : ""}`}
        onClick={() => props.onChange(!props.checked)}
      >
        <span className="clip-switch__thumb" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ feedback */

const LEVEL_ORDER: Record<Warning["level"], number> = { danger: 0, caution: 1, info: 2 };

export function Warnings(props: { warnings: Warning[] }) {
  if (!props.warnings.length) return null;
  const sorted = [...props.warnings].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  return (
    <div className="clip-warnings">
      {sorted.map((w) => (
        <div key={w.code + w.message} className={`clip-notice clip-notice--${w.level}`} role={w.level === "danger" ? "alert" : "status"}>
          <IconAlert />
          <span>{w.message}</span>
        </div>
      ))}
    </div>
  );
}

export function ErrorNote(props: { message: string | null | undefined }) {
  if (!props.message) return null;
  return (
    <div className="clip-notice clip-notice--danger" role="alert">
      <IconAlert />
      <span>{props.message}</span>
    </div>
  );
}

export function Spinner(props: { label?: string }) {
  return (
    <div className="clip-spinner" role="status" aria-live="polite">
      <span className="clip-spinner__dot" />
      <span className="clip-visually-hidden">{props.label ?? "Loading"}</span>
    </div>
  );
}

export function Empty(props: { title: string; children?: ReactNode }) {
  return (
    <div className="clip-empty">
      <p className="clip-empty__title">{props.title}</p>
      {props.children && <div className="clip-empty__body">{props.children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ assets */

export function AssetIcon(props: { symbol: string; logoUrl?: string; size?: number }) {
  const size = props.size ?? 36;
  // Only bundled logos (same-origin paths) are rendered; remote logos are untrusted like NFT media.
  if (props.logoUrl && props.logoUrl.startsWith("/")) {
    return <img className="clip-asset-icon" src={props.logoUrl} alt="" width={size} height={size} referrerPolicy="no-referrer" />;
  }
  const hue = hueFor(props.symbol);
  return (
    <span
      className="clip-asset-icon clip-asset-icon--letter"
      aria-hidden
      style={{ width: size, height: size, background: `hsl(${hue} 70% 92%)`, color: `hsl(${hue} 55% 32%)` }}
    >
      {props.symbol.slice(0, 1)}
    </span>
  );
}

/** Untrusted NFT media: proxied <img>/<video> only, never inline SVG/HTML/iframe. */
export function NftMedia(props: { nft: Nft; size?: "tile" | "full" }) {
  const { options } = useUi();
  const media = proxyMedia(props.nft.mediaUrl, options.mediaProxyUrl);
  const [failed, setFailed] = useState(false);
  const label = props.nft.name ?? `${props.nft.collection.name} #${props.nft.tokenId}`;
  if (!media || failed) {
    const hue = hueFor(props.nft.collection.address + props.nft.tokenId);
    return (
      <div
        className={`clip-nft-media clip-nft-media--placeholder clip-nft-media--${props.size ?? "tile"}`}
        role="img"
        aria-label={label}
        style={{ background: `linear-gradient(135deg, hsl(${hue} 75% 70%), hsl(${(hue + 50) % 360} 70% 45%))` }}
      >
        <span>{props.nft.collection.name.slice(0, 1)}</span>
      </div>
    );
  }
  if (media.kind === "video") {
    return (
      <video
        className={`clip-nft-media clip-nft-media--${props.size ?? "tile"}`}
        src={media.src}
        muted
        loop
        playsInline
        autoPlay={false}
        controls={props.size === "full"}
        preload="metadata"
        aria-label={label}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <img
      className={`clip-nft-media clip-nft-media--${props.size ?? "tile"}`}
      src={media.src}
      alt={label}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      crossOrigin="anonymous"
      onError={() => setFailed(true)}
    />
  );
}

/** QR rendered from our own SVG string into an <img> (never inlined). */
export function Qr(props: { value: string; label: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let live = true;
    QRCode.toString(props.value, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#141414", light: "#ffffff" } })
      .then((svg) => {
        if (live) setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      })
      .catch(() => setSrc(undefined));
    return () => {
      live = false;
    };
  }, [props.value]);
  return <div className="clip-qr">{src ? <img src={src} alt={props.label} width={200} height={200} /> : <Spinner />}</div>;
}

export function CopyButton(props: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(props.value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard may be blocked; the value is visible on screen */
        }
      }}
    >
      {done ? "Copied" : props.label ?? "Copy"}
    </Button>
  );
}
