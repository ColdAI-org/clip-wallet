import { useEffect, useMemo, useState } from "react";
import type { RecipientResolution } from "../client";
import { userMessageOf } from "../client";
import { useAsync, useRouter, useUi } from "../context";
import { AssetIcon, Button, ErrorNote, Field, Screen, Spinner } from "../components";
import { formatFiat, formatUnits, parseUnits, shortAddress } from "../lib/format";
import { mergeBalances } from "../lib/portfolio";

type Phase = { p: "form" } | { p: "ask"; res: Extract<RecipientResolution, { kind: "ask" }> } | { p: "sending" };

/**
 * Send: who + how much. The network is inferred from the address; only when several networks fit and
 * nothing tells them apart (an EVM address, an exchange deposit address) do we ask — once, in plain
 * words — and remember the answer for that recipient.
 */
export function Send(props: { assetKey?: string }) {
  const { client, state } = useUi();
  const { navigate } = useRouter();
  const { data } = useAsync(() => client.getPortfolio(), [client]);
  const assets = useMemo(() => mergeBalances(data?.balances ?? [], { pinned: state?.prefs.pinned }).assets, [data, state?.prefs.pinned]);
  const [assetId, setAssetId] = useState<string>("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<Phase>({ p: "form" });
  const [err, setErr] = useState<string | null>(null);
  const [choice, setChoice] = useState<string>("");

  useEffect(() => {
    if (!assetId && assets.length) setAssetId(assets.find((a) => a.key === props.assetKey && !a.bridged)?.id ?? assets[0]!.id);
  }, [assets, assetId, props.assetKey]);

  const asset = assets.find((a) => a.id === assetId);
  const currency = data?.currency ?? "USD";
  const parsed = asset ? parseUnits(amount, asset.decimals) : null;
  const tooMuch = asset && parsed !== null ? parsed > BigInt(asset.amount) : false;
  const amountErr = amount && parsed === null ? "Enter an amount like 25 or 0.5." : tooMuch ? `You have ${formatUnits(asset!.amount, asset!.decimals)} ${asset!.symbol}.` : null;
  const fiatPreview =
    asset && parsed !== null && asset.fiatValue !== undefined && BigInt(asset.amount) > 0n
      ? (Number(parsed) / Number(BigInt(asset.amount))) * asset.fiatValue
      : undefined;

  const submit = async (networkId: string, address: string) => {
    if (!asset) return;
    setPhase({ p: "sending" });
    try {
      const id = await client.send({ assetKey: asset.key, networkId, to: address, amount });
      navigate(`/approval/${encodeURIComponent(id)}`, { replace: true });
    } catch (e) {
      setErr(userMessageOf(e));
      setPhase({ p: "form" });
    }
  };

  const onContinue = async () => {
    if (!asset) return;
    setErr(null);
    try {
      const res = await client.resolveRecipient({ input: to.trim(), assetKey: asset.key });
      if (res.kind === "invalid") setErr(res.message);
      else if (res.kind === "resolved") await submit(res.networkId, res.address);
      else {
        setChoice("");
        setPhase({ p: "ask", res });
      }
    } catch (e) {
      setErr(userMessageOf(e));
    }
  };

  if (!data) return <Screen back title="Send"><Spinner /></Screen>;

  if (phase.p === "ask" && asset) {
    const res = phase.res;
    return (
      <Screen back={() => setPhase({ p: "form" })} title="Send">
        <div className="clip-ask" role="group" aria-labelledby="ask-h">
          <h1 id="ask-h" className="clip-h1">
            Where should the {asset.symbol} arrive?
          </h1>
          <p className="clip-lede">
            {res.displayName ?? shortAddress(res.address, 6)} can receive {asset.symbol} in more than one place. If it's an exchange or someone else's
            wallet, ask them which network to use — sending to the wrong one can lose the money.
          </p>
          <fieldset className="clip-options">
            <legend className="clip-visually-hidden">Network for this recipient</legend>
            {res.candidates.map((c) => (
              <label key={c.network.id} className={`clip-option ${choice === c.network.id ? "is-selected" : ""}`}>
                <input type="radio" name="network" value={c.network.id} checked={choice === c.network.id} onChange={() => setChoice(c.network.id)} />
                <span className="clip-option__title">{c.network.name}</span>
                <span className="clip-option__hint">
                  {BigInt(c.balance) > 0n ? `You have ${formatUnits(c.balance, asset.decimals, 4)} ${asset.symbol} there` : `We'll move your ${asset.symbol} there for you`}
                </span>
              </label>
            ))}
          </fieldset>
          <p className="clip-hint">We'll remember this for {res.displayName ?? "this address"} so you won't be asked again.</p>
          <ErrorNote message={err} />
          <Button
            block
            disabled={!choice}
            onClick={async () => {
              await client.rememberRecipientNetwork({ address: res.address, assetKey: asset.key, networkId: choice });
              await submit(choice, res.address);
            }}
          >
            Continue
          </Button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen back title="Send">
      <form
        className="clip-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void onContinue();
        }}
      >
        <label className="clip-field">
          <span className="clip-field__label">What</span>
          <div className="clip-asset-select">
            {asset && <AssetIcon symbol={asset.symbol} size={28} />}
            <select className="clip-select" value={assetId} onChange={(e) => setAssetId(e.target.value)} aria-label="Asset to send">
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.symbol}
                  {a.bridged ? " (bridged)" : ""} — {formatFiat(a.fiatValue, currency)}
                </option>
              ))}
            </select>
          </div>
        </label>
        <Field
          label="To"
          placeholder="Name or address"
          autoComplete="off"
          spellCheck={false}
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setErr(null);
          }}
        />
        <Field
          label="Amount"
          inputMode="decimal"
          placeholder="0"
          autoComplete="off"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={amountErr}
          hint={fiatPreview !== undefined ? `≈ ${formatFiat(fiatPreview, currency)}` : asset ? `You have ${formatUnits(asset.amount, asset.decimals, 4)} ${asset.symbol}` : undefined}
          trailing={
            asset && (
              <button type="button" className="clip-link" onClick={() => setAmount(formatUnits(asset.amount, asset.decimals, asset.decimals).replace(/,/g, ""))}>
                Max
              </button>
            )
          }
        />
        <ErrorNote message={err} />
        <Button block type="submit" disabled={!asset || !to.trim() || parsed === null || parsed === 0n || tooMuch || phase.p === "sending"}>
          {phase.p === "sending" ? "Preparing…" : "Review"}
        </Button>
      </form>
    </Screen>
  );
}
