/**
 * Extension pages. Each HTML entrypoint's script is one line:
 *   mountWallet("popup") | mountWallet("tab") | mountApprovalWindow()
 *
 * @module
 */
import "../shared/node-globals";

export { mountWallet, mountApprovalWindow } from "../pages/mount";
