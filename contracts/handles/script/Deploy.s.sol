// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {ClipHandles} from "../src/ClipHandles.sol";

interface VmBroadcast {
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// Deploys ClipHandles. The signer comes from the forge command line (an encrypted keystore via --account, or a
/// hardware wallet via --ledger); this script never reads a key. See README.md.
contract Deploy {
    VmBroadcast internal constant vm = VmBroadcast(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (ClipHandles handles) {
        vm.startBroadcast();
        handles = new ClipHandles();
        vm.stopBroadcast();
    }
}
