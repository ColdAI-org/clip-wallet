import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PluginInsights, PluginSettings, type PluginsClient, type PluginsStatusView } from "../src/plugins";
import { ApprovalScreen } from "../src/screens/Approval";
import { fakeClient, payApproval } from "./fake-client";
import { renderUi } from "./render";

const PERMS = ["See the requests you're asked to approve and add notes to them. Notes are marked \"from Address labels\".", "It can never sign, move your funds, or see your recovery phrase or keys."];

function pluginsClient(st: Partial<PluginsStatusView> = {}, over: Partial<PluginsClient> = {}): PluginsClient {
  let status: PluginsStatusView = { advanced: true, enabled: true, active: true, plugins: [], ...st };
  return {
    pluginsStatus: vi.fn(async () => status),
    pluginsSetEnabled: vi.fn(async ({ enabled }) => {
      status = { ...status, enabled, active: enabled && status.advanced };
    }),
    pluginsPrepareInstall: vi.fn(async ({ name }) => ({ id: name, name: "Address labels", version: "1.0.0", author: "Clip Wallet examples", description: "Names well-known addresses.", permissions: PERMS, enabled: true, installedAt: 0, integrity: "sha512-x" })),
    pluginsConfirmInstall: vi.fn(async ({ id }) => {
      const v = { id, name: "Address labels", version: "1.0.0", author: "Clip Wallet examples", description: "Names well-known addresses.", permissions: PERMS, enabled: true, installedAt: 1 };
      status = { ...status, plugins: [v] };
      return v;
    }),
    pluginsCancelInstall: vi.fn(async () => undefined),
    pluginsRemove: vi.fn(async () => undefined),
    pluginsSetPluginEnabled: vi.fn(async () => undefined),
    ...over,
  };
}

const render = (p: PluginsClient) => {
  const c = { ...fakeClient(), ...p };
  return renderUi(<PluginSettings />, { client: c });
};

describe("Plugins settings", () => {
  it("is an Advanced-mode feature", async () => {
    render(pluginsClient({ advanced: false, enabled: false, active: false }));
    expect(await screen.findByText("Plugins are an Advanced feature")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("is off by default; install shows the permission prompt and needs an explicit yes", async () => {
    const user = userEvent.setup();
    const p = pluginsClient({ enabled: false, active: false });
    render(p);
    expect(await screen.findByText(/can never sign, move your funds/)).toBeInTheDocument();
    expect(screen.queryByLabelText("npm package name")).not.toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Use plugins" }));
    await user.type(await screen.findByLabelText("npm package name"), "clip-plugin-address-label");
    await user.click(screen.getByRole("button", { name: "Look up plugin" }));
    const prompt = await screen.findByTestId("plugin-permission-prompt");
    expect(within(prompt).getByText("Install Address labels 1.0.0?")).toBeInTheDocument();
    expect(within(prompt).getByText(/Notes are marked "from Address labels"/)).toBeInTheDocument();
    expect(p.pluginsConfirmInstall).not.toHaveBeenCalled();
    await user.click(within(prompt).getByRole("button", { name: "Install" }));
    expect(p.pluginsConfirmInstall).toHaveBeenCalledWith({ id: "clip-plugin-address-label", version: "1.0.0" });
    expect(await screen.findByRole("button", { name: "Remove Address labels" })).toBeInTheDocument();
  });

  it("shows install errors in plain words", async () => {
    const user = userEvent.setup();
    const p = pluginsClient({}, {
      pluginsPrepareInstall: vi.fn(async () => {
        throw Object.assign(new Error("x"), { userMessage: "That plugin's download didn't match npm's checksum, so it wasn't installed.", code: "plugins/integrity" });
      }),
    });
    render(p);
    await user.type(await screen.findByLabelText("npm package name"), "clip-plugin-evil");
    await user.click(screen.getByRole("button", { name: "Look up plugin" }));
    expect(await screen.findByText(/didn't match npm's checksum/)).toBeInTheDocument();
  });
});

describe("plugin notes in approvals", () => {
  const insight = {
    pluginId: "clip-plugin-address-label",
    pluginName: "Address labels",
    from: "from Address labels",
    lines: [{ label: "Address", value: "Burn address" }],
    warnings: [{ level: "danger" as const, message: "Funds sent to the burn address are gone for good." }],
  };

  it("are shown apart, titled with the plugin, and marked as not checked by the wallet", () => {
    renderUi(<PluginInsights insights={[insight]} />);
    const box = screen.getByTestId("plugin-insights");
    expect(within(box).getByText("From Address labels")).toBeInTheDocument();
    expect(within(box).getByText("Burn address")).toBeInTheDocument();
    expect(within(box).getByText(/not checked by Clip Wallet/)).toBeInTheDocument();
  });

  it("render on the approval screen when the request carries them", async () => {
    const approval = payApproval({}, { pluginInsights: [insight] } as never);
    renderUi(<ApprovalScreen approval={approval} />);
    expect(await screen.findByText("From Address labels")).toBeInTheDocument();
  });
});
