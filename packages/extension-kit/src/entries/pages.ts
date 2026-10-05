/**
 * Extension pages. Each HTML entrypoint's script is one line:
 *   mountWallet("popup") | mountWallet("tab") | mountApprovalWindow()
 */
import "../shared/node-globals";

export { mountWallet, mountApprovalWindow } from "../pages/mount";
