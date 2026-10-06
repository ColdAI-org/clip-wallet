// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {ClipHandles} from "../src/ClipHandles.sol";
import {Test} from "./utils/Test.sol";

contract ClipHandlesTest is Test {
    ClipHandles internal h;
    address internal constant ALEX = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    event Registered(bytes32 indexed key, string handle, address indexed owner);
    event AddressChanged(bytes32 indexed key, string family, string addr);

    function setUp() public {
        h = new ClipHandles();
        vm.warp(1_790_000_000);
    }

    function _registerAlex() internal {
        vm.prank(ALEX);
        h.register("alex");
    }

    function test_register_setsOwnerAndEmits() public {
        vm.expectEmit(true, true, false, true);
        emit Registered(keccak256("alex"), "alex", ALEX);
        _registerAlex();
        assertEq(h.ownerOf("alex"), ALEX, "owner");
        assertTrue(!h.isAvailable("alex"), "taken");
        (address owner, uint64 at,,,) = h.recordsOf("alex");
        assertEq(owner, ALEX, "records owner");
        assertEq(at, 1_790_000_000, "registeredAt");
    }

    function test_register_rejectsTakenAndSecondHandle() public {
        _registerAlex();
        vm.prank(BOB);
        vm.expectRevert(ClipHandles.HandleTaken.selector);
        h.register("alex");
        vm.prank(ALEX);
        vm.expectRevert(ClipHandles.AlreadyHasHandle.selector);
        h.register("alex2");
    }

    function test_handleValidation() public view {
        assertTrue(h.isValidHandle("abc"), "3 chars");
        assertTrue(h.isValidHandle("a-b-c"), "single hyphens");
        assertTrue(h.isValidHandle("x0123456789012345678901234567890"), "32 chars");
        assertTrue(!h.isValidHandle("ab"), "too short");
        assertTrue(!h.isValidHandle("x01234567890123456789012345678901"), "33 chars");
        assertTrue(!h.isValidHandle("Alex"), "uppercase");
        assertTrue(!h.isValidHandle("-alex"), "leading hyphen");
        assertTrue(!h.isValidHandle("alex-"), "trailing hyphen");
        assertTrue(!h.isValidHandle("al--ex"), "double hyphen");
        assertTrue(!h.isValidHandle("al ex"), "space");
        assertTrue(!h.isValidHandle("al.ex"), "dot");
        assertTrue(!h.isValidHandle(unicode"аlex"), "cyrillic a");
    }

    function test_register_rejectsInvalid() public {
        vm.prank(ALEX);
        vm.expectRevert(ClipHandles.InvalidHandle.selector);
        h.register("Alex");
    }

    function test_records_setUpdateClear() public {
        _registerAlex();
        vm.startPrank(ALEX);
        vm.expectEmit(true, false, false, true);
        emit AddressChanged(keccak256("alex"), "evm", "0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
        h.setAddress("evm", "0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
        h.setAddress("solana", "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH");
        assertEq(h.addressOf("alex", "evm"), "0x9858EfFD232B4033E47d90003D41EC34EcaEda94", "evm");
        h.setAddress("evm", "0x1234567890AbcdEF1234567890aBcdef12345678");
        (,,, string[] memory fams, string[] memory addrs) = h.recordsOf("alex");
        assertEq(fams.length, 2, "two families after update");
        assertEq(addrs[0], "0x1234567890AbcdEF1234567890aBcdef12345678", "updated");
        h.setAddress("evm", "");
        (,,, fams, addrs) = h.recordsOf("alex");
        assertEq(fams.length, 1, "cleared");
        assertEq(fams[0], "solana", "solana remains");
        assertEq(h.addressOf("alex", "evm"), "", "evm gone");
        h.setAddress("bitcoin", ""); // clearing an absent record is a no-op
        vm.stopPrank();
    }

    function test_records_batch() public {
        _registerAlex();
        string[] memory f = new string[](2);
        string[] memory a = new string[](2);
        f[0] = "hedera";
        a[0] = "0.0.1234";
        f[1] = "bitcoin";
        a[1] = "tb1qxyz";
        vm.prank(ALEX);
        h.setAddresses(f, a);
        assertEq(h.addressOf("alex", "hedera"), "0.0.1234", "hedera");
        string[] memory short = new string[](1);
        vm.prank(ALEX);
        vm.expectRevert(ClipHandles.LengthMismatch.selector);
        h.setAddresses(f, short);
    }

    function test_records_onlyOwner() public {
        _registerAlex();
        vm.prank(BOB);
        vm.expectRevert(ClipHandles.NoHandle.selector);
        h.setAddress("evm", "0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
    }

    function test_records_validation() public {
        _registerAlex();
        vm.startPrank(ALEX);
        vm.expectRevert(ClipHandles.InvalidFamily.selector);
        h.setAddress("EVM", "0xabc");
        vm.expectRevert(ClipHandles.InvalidFamily.selector);
        h.setAddress("", "0xabc");
        vm.expectRevert(ClipHandles.InvalidAddressRecord.selector);
        h.setAddress("evm", "0x12 34");
        vm.expectRevert(ClipHandles.InvalidAddressRecord.selector);
        h.setAddress("evm", string(abi.encodePacked("0x12", hex"e280ae", "34"))); // U+202E right-to-left override
        bytes memory long = new bytes(129);
        for (uint256 i = 0; i < long.length; i++) long[i] = "a";
        vm.expectRevert(ClipHandles.InvalidAddressRecord.selector);
        h.setAddress("evm", string(long));
        vm.stopPrank();
    }

    function test_records_cap() public {
        _registerAlex();
        vm.startPrank(ALEX);
        for (uint256 i = 0; i < 16; i++) h.setAddress(string(abi.encodePacked("f", bytes1(uint8(0x61 + i)))), "addr");
        vm.expectRevert(ClipHandles.TooManyRecords.selector);
        h.setAddress("zz", "addr");
        h.setAddress("fa", "addr2"); // updating an existing family still works at the cap
        vm.stopPrank();
    }

    function test_release_clearsEverythingAndCoolsDown() public {
        _registerAlex();
        vm.startPrank(ALEX);
        h.setAddress("evm", "0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
        h.setReverse(true);
        assertEq(h.handleOf(ALEX), "alex", "reverse on");
        h.release();
        vm.stopPrank();
        assertEq(h.ownerOf("alex"), address(0), "no owner");
        assertEq(h.addressOf("alex", "evm"), "", "records cleared");
        assertEq(h.handleOf(ALEX), "", "reverse cleared");
        assertTrue(!h.reverseEnabled(ALEX), "reverse flag cleared");
        assertTrue(!h.isAvailable("alex"), "cooling down");

        vm.prank(BOB);
        vm.expectRevert(abi.encodeWithSelector(ClipHandles.CoolingDown.selector, uint64(1_790_000_000 + 30 days)));
        h.register("alex");

        vm.warp(1_790_000_000 + 30 days);
        assertTrue(h.isAvailable("alex"), "free after cooldown");
        vm.prank(BOB);
        h.register("alex");
        assertEq(h.ownerOf("alex"), BOB, "bob owns it");
        assertEq(h.addressOf("alex", "evm"), "", "old records never come back");
    }

    function test_release_previousOwnerMayReclaim() public {
        _registerAlex();
        vm.prank(ALEX);
        h.release();
        vm.prank(ALEX);
        h.register("alex");
        assertEq(h.ownerOf("alex"), ALEX, "reclaimed");
    }

    function test_release_thenRegisterAnother() public {
        _registerAlex();
        vm.startPrank(ALEX);
        h.release();
        h.register("alexander");
        vm.stopPrank();
        assertEq(h.ownerOf("alexander"), ALEX, "new handle");
    }

    function test_reverse_isOptIn() public {
        _registerAlex();
        assertEq(h.handleOf(ALEX), "", "off by default");
        assertEq(h.ownedHandle(ALEX), "alex", "own handle always readable");
        assertEq(h.ownedHandle(BOB), "", "none");
        vm.prank(ALEX);
        h.setReverse(true);
        assertEq(h.handleOf(ALEX), "alex", "on");
        vm.prank(ALEX);
        h.setReverse(false);
        assertEq(h.handleOf(ALEX), "", "off again");
        vm.prank(BOB);
        vm.expectRevert(ClipHandles.NoHandle.selector);
        h.setReverse(true);
    }

    /// Any string the contract accepts is a valid handle by the documented rule, and vice versa.
    function testFuzz_validationMatchesRule(bytes memory raw) public view {
        string memory s = string(raw);
        bool ok = raw.length >= 3 && raw.length <= 32;
        for (uint256 i = 0; ok && i < raw.length; i++) {
            bytes1 c = raw[i];
            bool alnum = (c >= "a" && c <= "z") || (c >= "0" && c <= "9");
            if (!alnum && !(c == "-" && i > 0 && i < raw.length - 1 && raw[i - 1] != "-")) ok = false;
        }
        assertTrue(this.isValid(s) == ok, "rule");
    }

    function isValid(string calldata s) external view returns (bool) {
        return h.isValidHandle(s);
    }

    function testFuzz_onlyOwnerWrites(address stranger) public {
        vm.assume(stranger != ALEX);
        _registerAlex();
        vm.prank(stranger);
        vm.expectRevert(ClipHandles.NoHandle.selector);
        h.setAddress("evm", "0xabc");
        vm.prank(stranger);
        vm.expectRevert(ClipHandles.NoHandle.selector);
        h.release();
    }
}
