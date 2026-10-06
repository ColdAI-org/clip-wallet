// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// The handful of Foundry cheatcodes these tests use (https://getfoundry.sh/reference/cheatcodes/overview),
/// declared here so the project has no git-submodule dependency on forge-std.
interface Vm {
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function warp(uint256 timestamp) external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
    function expectEmit(bool topic1, bool topic2, bool topic3, bool data) external;
    function assume(bool condition) external;
}

abstract contract Test {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertEq(uint256 a, uint256 b, string memory what) internal pure {
        require(a == b, what);
    }

    function assertEq(address a, address b, string memory what) internal pure {
        require(a == b, what);
    }

    function assertEq(string memory a, string memory b, string memory what) internal pure {
        require(keccak256(bytes(a)) == keccak256(bytes(b)), what);
    }

    function assertTrue(bool v, string memory what) internal pure {
        require(v, what);
    }
}
