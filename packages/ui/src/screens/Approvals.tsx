import { useCallback, useEffect, useState } from "react";
import type { ApprovalView } from "../client";
import { userMessageOf } from "../client";
import { useUi } from "../context";
import { Empty, ErrorNote, Screen, Spinner } from "../components";
import { ApprovalScreen } from "./Approval";

/** Shows the oldest waiting request, then the next, until the queue is empty. */
export function ApprovalQueue(props: { focusId?: string; onEmpty?: () => void; standalone?: boolean }) {
  const { client, refresh } = useUi();
  const [items, setItems] = useState<ApprovalView[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [focus, setFocus] = useState(props.focusId);

  const load = useCallback(async () => {
    try {
      const list = await client.listApprovals();
      setItems(list);
      if (list.length === 0) props.onEmpty?.();
    } catch (e) {
      setErr(userMessageOf(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);
  // Re-fetch on background changes: hardware signing steps (Ledger confirm, Keystone QR) arrive this way.
  useEffect(() => client.onChange?.(() => void load()), [client, load]);

  const current = items?.find((i) => i.id === focus) ?? items?.[0];
  const body = err ? (
    <ErrorNote message={err} />
  ) : !items ? (
    <Spinner />
  ) : !current ? (
    <Empty title="Nothing waiting for you" />
  ) : (
    <>
      {items.length > 1 && <p className="clip-queue-count">1 of {items.length} requests</p>}
      <ApprovalScreen
        key={current.id}
        approval={current}
        onDone={async () => {
          setFocus(undefined);
          await load();
          await refresh();
        }}
      />
    </>
  );
  return props.standalone ? <div className="clip-screen clip-screen--approval">{body}</div> : <Screen back>{body}</Screen>;
}
