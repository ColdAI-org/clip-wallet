import { useEffect, useMemo, useState } from "react";
import type { Family } from "@clip-wallet/core";
import type { RecipientResolution } from "../client";
import { userMessageOf } from "../client";
import { useAsync, useRouter, useUi } from "../context";
import { AssetIcon, Button, ErrorNote, Field, Screen, Spinner } from "../components";
import { amountInput, canonicalAmount, formatFiat, formatUnits, parseUnits, shortAddress } from "../lib/format";
import { mergeBalances } from "../lib/portfolio";
import { useUiT } from "../i18n";
import { useSocialOptional } from "../social/context";
import { ContactSuggestions } from "../social/Contacts";

type Phase = { p: "form" } | { p: "ask"; res: Extract<RecipientResolution, { kind: "ask" }> } | { p: "sending" };

/**
 * Send: who + how much. The network is inferred from the address; only when several networks fit and
 * nothing tells them apart (an EVM address, an exchange deposit address) do we ask — once, in plain
 * words — and remember the answer for that recipient. With the social stream, "To" also searches contacts.
 */
export function Send(props: { assetKey?: string }) {
  const t = useUiT();
  const { client, state } = useUi();
  const social = useSocialOptional();
  const { navigate } = useRouter();
  const { data } = useAsync(() => client.getPortfolio(), [client]);
  const assets = useMemo(() => mergeBalances(data?.balances ?? [], { pinned: state?.prefs.pinned }).assets, [data, state?.prefs.pinned]);
  const [assetId, setAssetId] = useState<string>("");
  const [to, setTo] = useState("");
  const [contactName, setContactName] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<Phase>({ p: "form" });
  const [err, setErr] = useState<string | null>(null);
  const [choice, setChoice] = useState<string>("");

  useEffect(() => {
    if (!assetId && assets.length) setAssetId(assets.find((a) => a.key === props.assetKey && !a.bridged)?.id ?? assets[0]!.id);
  }, [assets, assetId, props.assetKey]);

  const asset = assets.find((a) => a.id === assetId);
  const currency = data?.currency ?? "USD";
  // The asset's family, when all its networks share one (USDC on EVM and Solana: no filter).
  const family = useMemo<Family | undefined>(() => {
    if (!asset || !data) return undefined;
    const fams = new Set(data.balances.filter((b) => b.asset.key === asset.key).map((b) => data.networks.find((n) => n.id === b.asset.networkId)?.family));
    return fams.size === 1 ? ([...fams][0] as Family | undefined) : undefined;
  }, [asset, data]);
  const parsed = asset ? parseUnits(amount, asset.decimals) : null;
  const tooMuch = asset && parsed !== null ? parsed > BigInt(asset.amount) : false;
  const amountErr =
    amount && parsed === null ? t("send.amountBad") : tooMuch ? t("send.youHaveOnly", { amount: formatUnits(asset!.amount, asset!.decimals), symbol: asset!.symbol }) : null;
  const fiatPreview =
    asset && parsed !== null && asset.fiatValue !== undefined && BigInt(asset.amount) > 0n
      ? (Number(parsed) / Number(BigInt(asset.amount))) * asset.fiatValue
      : undefined;

  const submit = async (networkId: string, address: string) => {
    if (!asset) return;
    const canonical = canonicalAmount(amount);
    if (!canonical) return setErr(t("send.amountBad"));
    setPhase({ p: "sending" });
    try {
      const id = await client.send({ assetKey: asset.key, networkId, to: address, amount: canonical });
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

  if (!data) {
    return (
      <Screen back title={t("send.title")}>
        <Spinner />
      </Screen>
    );
  }

  if (phase.p === "ask" && asset) {
    const res = phase.res;
    const who = contactName ?? res.displayName;
    return (
      <Screen back={() => setPhase({ p: "form" })} title={t("send.title")}>
        <div className="clip-ask" role="group" aria-labelledby="ask-h">
          <h1 id="ask-h" className="clip-h1">
            {t("send.ask.title", { symbol: asset.symbol })}
          </h1>
          <p className="clip-lede">{t("send.ask.lede", { who: who ?? shortAddress(res.address, 6), symbol: asset.symbol })}</p>
          <fieldset className="clip-options">
            <legend className="clip-visually-hidden">{t("send.ask.legend")}</legend>
            {res.candidates.map((c) => (
              <label key={c.network.id} className={`clip-option ${choice === c.network.id ? "is-selected" : ""}`}>
                <input type="radio" name="network" value={c.network.id} checked={choice === c.network.id} onChange={() => setChoice(c.network.id)} />
                <span className="clip-option__title">{c.network.name}</span>
                <span className="clip-option__hint">
                  {BigInt(c.balance) > 0n
                    ? t("send.ask.haveThere", { amount: formatUnits(c.balance, asset.decimals, 4), symbol: asset.symbol })
                    : t("send.ask.moveThere", { symbol: asset.symbol })}
                </span>
              </label>
            ))}
          </fieldset>
          <p className="clip-hint">{who ? t("send.ask.rememberName", { name: who }) : t("send.ask.rememberAddress")}</p>
          <ErrorNote message={err} />
          <Button
            block
            disabled={!choice}
            onClick={async () => {
              await client.rememberRecipientNetwork({ address: res.address, assetKey: asset.key, networkId: choice });
              await submit(choice, res.address);
            }}
          >
            {t("common.continue")}
          </Button>
        </div>
      </Screen>
    );
  }

  const typed = to.trim();
  return (
    <Screen back title={t("send.title")}>
      <form
        className="clip-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void onContinue();
        }}
      >
        <label className="clip-field">
          <span className="clip-field__label">{t("send.what")}</span>
          <div className="clip-asset-select">
            {asset && <AssetIcon symbol={asset.symbol} size={28} />}
            <select className="clip-select" value={assetId} onChange={(e) => setAssetId(e.target.value)} aria-label={t("send.assetLabel")}>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {t(a.bridged ? "send.assetOptionBridged" : "send.assetOption", { symbol: a.symbol, value: formatFiat(a.fiatValue, currency) })}
                </option>
              ))}
            </select>
          </div>
        </label>
        <Field
          label={t("send.to")}
          placeholder={social ? t("send.toPlaceholder") : t("send.toPlaceholderPlain")}
          autoComplete="off"
          spellCheck={false}
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setContactName(null);
            setErr(null);
          }}
          hint={contactName ? t("send.toContact", { name: contactName }) : undefined}
        />
        {social && !contactName && typed.length > 0 && typed.length < 60 && (
          <ContactSuggestions
            query={typed}
            {...(family ? { family } : {})}
            onPick={(address, name) => {
              setTo(address);
              setContactName(name);
              setErr(null);
            }}
          />
        )}
        <Field
          label={t("send.amount")}
          inputMode="decimal"
          placeholder="0"
          autoComplete="off"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={amountErr}
          hint={
            fiatPreview !== undefined
              ? t("send.approx", { value: formatFiat(fiatPreview, currency) })
              : asset
                ? t("send.youHave", { amount: formatUnits(asset.amount, asset.decimals, 4), symbol: asset.symbol })
                : undefined
          }
          trailing={
            asset && (
              <button type="button" className="clip-link" onClick={() => setAmount(amountInput(asset.amount, asset.decimals))}>
                {t("common.max")}
              </button>
            )
          }
        />
        <ErrorNote message={err} />
        <Button block type="submit" disabled={!asset || !to.trim() || parsed === null || parsed === 0n || tooMuch || phase.p === "sending"}>
          {phase.p === "sending" ? t("send.preparing") : t("send.review")}
        </Button>
      </form>
    </Screen>
  );
}
