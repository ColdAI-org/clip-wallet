import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import type { WalletClient, WalletState } from "../src/client";
import { ClipProvider, Router } from "../src/context";
import { fakeClient, state } from "./fake-client";

export function renderUi(ui: ReactElement, opts: { client?: WalletClient; state?: WalletState; route?: string } = {}) {
  const client = opts.client ?? fakeClient();
  const st = opts.state ?? state();
  const utils = render(
    <ClipProvider client={client} initialState={st}>
      <Router memory initial={opts.route ?? "/"}>
        {ui}
      </Router>
    </ClipProvider>,
  );
  return { ...utils, client };
}
