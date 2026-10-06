// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @title ClipHandles
/// @notice Opt-in handles for Clip Wallet: "@alex" → the addresses Alex chose to publish, one per network family
///         ("evm", "solana", "hedera", "bitcoin", …). Deployed on Hedera's EVM; the owner of a handle is the account
///         that registered it (msg.sender: the Hedera account's EVM address from its ECDSA public key).
///
/// Everything here is public, forever: publishing several addresses under one handle links them to each other and
/// to the handle for anyone reading the chain. The wallet shows a warning before it publishes.
///
/// Rules:
///  - Handles are 3–32 chars of [a-z0-9-], starting and ending with a letter or digit, no "--". ASCII only, so a
///    look-alike Unicode handle ("аlex" with a Cyrillic а) can't exist.
///  - One handle per owner. No transfers: a handle can only be released.
///  - After a release, only the previous owner may take the handle again for RELEASE_COOLDOWN, so a released handle
///    can't be grabbed straight away by someone hoping to receive payments meant for the old owner.
///  - Records: up to MAX_RECORDS families; family ids are [a-z0-9-] 1–16 chars; values are printable ASCII without
///    spaces, 1–128 bytes (no bidi or zero-width characters). Clients still validate each value with the family's
///    address rules before showing or paying it.
///  - Reverse lookup (address → handle) is a separate opt-in.
contract ClipHandles {
    uint256 public constant MIN_LENGTH = 3;
    uint256 public constant MAX_LENGTH = 32;
    uint256 public constant MAX_FAMILY_LENGTH = 16;
    uint256 public constant MAX_ADDRESS_LENGTH = 128;
    uint256 public constant MAX_RECORDS = 16;
    uint64 public constant RELEASE_COOLDOWN = 30 days;

    struct Handle {
        address owner;
        uint64 registeredAt;
        uint64 updatedAt;
        string name;
        string[] families;
    }

    /// keccak256(handle) → handle.
    mapping(bytes32 => Handle) private _handles;
    /// keccak256(handle) → keccak256(family) → address record.
    mapping(bytes32 => mapping(bytes32 => string)) private _records;
    /// owner → keccak256(handle) (zero when none).
    mapping(address => bytes32) private _ownedBy;
    /// owner → whether handleOf(owner) answers.
    mapping(address => bool) public reverseEnabled;
    /// keccak256(handle) → who released it, and when (for the cooldown).
    mapping(bytes32 => address) public releasedBy;
    mapping(bytes32 => uint64) public releasedAt;

    event Registered(bytes32 indexed key, string handle, address indexed owner);
    event AddressChanged(bytes32 indexed key, string family, string addr);
    event Released(bytes32 indexed key, string handle, address indexed owner);
    event ReverseChanged(address indexed owner, bool enabled);

    error InvalidHandle();
    error HandleTaken();
    error AlreadyHasHandle();
    error NoHandle();
    error InvalidFamily();
    error InvalidAddressRecord();
    error TooManyRecords();
    error LengthMismatch();
    error CoolingDown(uint64 until);

    /* ------------------------------------------------------------------ writes */

    /// @notice Claims `handle` for the caller. Lowercase only: clients normalise before calling.
    function register(string calldata handle) external {
        if (!isValidHandle(handle)) revert InvalidHandle();
        if (_ownedBy[msg.sender] != bytes32(0)) revert AlreadyHasHandle();
        bytes32 key = keccak256(bytes(handle));
        if (_handles[key].owner != address(0)) revert HandleTaken();
        uint64 until = releasedAt[key] + RELEASE_COOLDOWN;
        if (releasedBy[key] != address(0) && releasedBy[key] != msg.sender && block.timestamp < until) revert CoolingDown(until);

        Handle storage h = _handles[key];
        h.owner = msg.sender;
        h.registeredAt = uint64(block.timestamp);
        h.updatedAt = uint64(block.timestamp);
        h.name = handle;
        _ownedBy[msg.sender] = key;
        delete releasedBy[key];
        delete releasedAt[key];
        emit Registered(key, handle, msg.sender);
    }

    /// @notice Publishes (or, with an empty `addr`, removes) the caller's address for one family.
    function setAddress(string calldata family, string calldata addr) external {
        bytes32 key = _requireOwned();
        _set(key, family, addr);
        _handles[key].updatedAt = uint64(block.timestamp);
    }

    /// @notice Several families at once (same rules as setAddress).
    function setAddresses(string[] calldata families, string[] calldata addrs) external {
        if (families.length != addrs.length) revert LengthMismatch();
        bytes32 key = _requireOwned();
        for (uint256 i = 0; i < families.length; i++) _set(key, families[i], addrs[i]);
        _handles[key].updatedAt = uint64(block.timestamp);
    }

    /// @notice Gives the caller's handle up: every record and the reverse entry go with it.
    function release() external {
        bytes32 key = _requireOwned();
        Handle storage h = _handles[key];
        string[] storage fams = h.families;
        for (uint256 i = 0; i < fams.length; i++) delete _records[key][keccak256(bytes(fams[i]))];
        string memory name = h.name;
        delete _handles[key];
        delete _ownedBy[msg.sender];
        if (reverseEnabled[msg.sender]) {
            delete reverseEnabled[msg.sender];
            emit ReverseChanged(msg.sender, false);
        }
        releasedBy[key] = msg.sender;
        releasedAt[key] = uint64(block.timestamp);
        emit Released(key, name, msg.sender);
    }

    /// @notice Lets wallets show the caller's handle next to their address (or stops it).
    function setReverse(bool enabled) external {
        _requireOwned();
        reverseEnabled[msg.sender] = enabled;
        emit ReverseChanged(msg.sender, enabled);
    }

    /* ------------------------------------------------------------------ reads */

    function ownerOf(string calldata handle) external view returns (address) {
        return _handles[keccak256(bytes(handle))].owner;
    }

    function addressOf(string calldata handle, string calldata family) external view returns (string memory) {
        return _records[keccak256(bytes(handle))][keccak256(bytes(family))];
    }

    /// @notice Everything a resolver needs in one call. `owner` is zero when the handle is free.
    function recordsOf(string calldata handle)
        external
        view
        returns (address owner, uint64 registeredAt, uint64 updatedAt, string[] memory families, string[] memory addrs)
    {
        bytes32 key = keccak256(bytes(handle));
        Handle storage h = _handles[key];
        families = h.families;
        addrs = new string[](families.length);
        for (uint256 i = 0; i < families.length; i++) addrs[i] = _records[key][keccak256(bytes(families[i]))];
        return (h.owner, h.registeredAt, h.updatedAt, families, addrs);
    }

    /// @notice The handle `owner` holds ("" for none), regardless of the reverse flag: ownership is public anyway
    ///         (Registered events). Wallets use it to show the user their own handle; to label other people's
    ///         addresses they must use handleOf, which honours the opt-in.
    function ownedHandle(address owner) external view returns (string memory) {
        bytes32 key = _ownedBy[owner];
        return key == bytes32(0) ? "" : _handles[key].name;
    }

    /// @notice The handle of `owner`, or "" when they have none or haven't turned reverse lookup on.
    function handleOf(address owner) external view returns (string memory) {
        bytes32 key = _ownedBy[owner];
        if (key == bytes32(0) || !reverseEnabled[owner]) return "";
        return _handles[key].name;
    }

    function isAvailable(string calldata handle) external view returns (bool) {
        if (!isValidHandle(handle)) return false;
        bytes32 key = keccak256(bytes(handle));
        if (_handles[key].owner != address(0)) return false;
        return releasedBy[key] == address(0) || block.timestamp >= releasedAt[key] + RELEASE_COOLDOWN;
    }

    function isValidHandle(string calldata handle) public pure returns (bool) {
        bytes calldata b = bytes(handle);
        if (b.length < MIN_LENGTH || b.length > MAX_LENGTH) return false;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            bool alnum = (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39);
            if (alnum) continue;
            if (c != 0x2d || i == 0 || i == b.length - 1 || b[i - 1] == 0x2d) return false;
        }
        return true;
    }

    /* ------------------------------------------------------------------ internals */

    function _requireOwned() private view returns (bytes32 key) {
        key = _ownedBy[msg.sender];
        if (key == bytes32(0)) revert NoHandle();
    }

    function _set(bytes32 key, string calldata family, string calldata addr) private {
        if (!_validFamily(family)) revert InvalidFamily();
        bytes32 fk = keccak256(bytes(family));
        Handle storage h = _handles[key];
        bool had = bytes(_records[key][fk]).length != 0;
        if (bytes(addr).length == 0) {
            if (!had) return;
            delete _records[key][fk];
            _removeFamily(h.families, fk);
        } else {
            if (!_validAddress(addr)) revert InvalidAddressRecord();
            if (!had) {
                if (h.families.length >= MAX_RECORDS) revert TooManyRecords();
                h.families.push(family);
            }
            _records[key][fk] = addr;
        }
        emit AddressChanged(key, family, addr);
    }

    function _removeFamily(string[] storage fams, bytes32 fk) private {
        uint256 n = fams.length;
        for (uint256 i = 0; i < n; i++) {
            if (keccak256(bytes(fams[i])) == fk) {
                fams[i] = fams[n - 1];
                fams.pop();
                return;
            }
        }
    }

    function _validFamily(string calldata family) private pure returns (bool) {
        bytes calldata b = bytes(family);
        if (b.length == 0 || b.length > MAX_FAMILY_LENGTH) return false;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            if (!((c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x2d)) return false;
        }
        return true;
    }

    function _validAddress(string calldata addr) private pure returns (bool) {
        bytes calldata b = bytes(addr);
        if (b.length == 0 || b.length > MAX_ADDRESS_LENGTH) return false;
        for (uint256 i = 0; i < b.length; i++) if (b[i] < 0x21 || b[i] > 0x7e) return false;
        return true;
    }
}
