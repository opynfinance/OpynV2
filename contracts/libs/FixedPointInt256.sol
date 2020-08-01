/**
 * SPDX-License-Identifier: UNLICENSED
 */
pragma solidity 0.6.10;

import "../packages/oz/SignedSafeMath.sol";

/**
 *
 */
library FixedPointInt256 {
    using SignedSafeMath for int256;

    int256 private constant SCALING_FACTOR = 1e18;

    /**
     * @notice convert an unsigned integer to signed integer
     * @param a uint to convert into a signed integer.
     * @return the converted signed integer.
     */
    function uintToInt(uint256 a) internal pure returns (int256) {
        require(a < uint256(-1), "FixedPointInt256: out of int range");

        return int256(a);
    }

    /**
     * @notice convert a signed integer to unsigned integer
     * @param a int to convert into an unsigned integer.
     * @return the converted unsigned integer.
     */
    function intToUint(int256 a) internal pure returns (uint256) {
        if (a < 0) {
            return uint256(-a);
        } else {
            return uint256(a);
        }
    }

    /**
     * @notice return the sum of two signed integer
     * @param a signed integer
     * @param b signed integer
     * @return sum of two signed integer
     */
    function add(int256 a, int256 b) internal pure returns (int256) {
        return a.add(b);
    }

    /**
     * @notice return the difference of two signed integer
     * @param a signed integer
     * @param b signed integer
     * @return difference of two signed integer
     */
    function sub(int256 a, int256 b) internal pure returns (int256) {
        return a.sub(b);
    }

    /**
     * @notice multiply two signed integer
     * @dev rounds to zero if a*b < SCALING_FACTOR / 2
     * @param a signed integer
     * @param b signed integer
     * @return mul of two signed integer
     */
    function mul(int256 a, int256 b) internal pure returns (int256) {
        return (a.mul(b)).add(SCALING_FACTOR / 2) / SCALING_FACTOR;
    }

    /**
     * @notice divide two signed integer
     * @dev rounds to zero if a*b < SCALING_FACTOR / 2
     * @param a signed integer
     * @param b signed integer
     * @return div of two signed integer
     */
    function div(int256 a, int256 b) internal pure returns (int256) {
        return (a.mul(SCALING_FACTOR)).add(b / 2) / b;
    }

    /**
     * @notice the minimum between a and b
     * @param a signed integer
     * @param b signed integer
     * @return min of two signed integer
     */
    function min(int256 a, int256 b) internal pure returns (int256) {
        return a < b ? a : b;
    }

    /**
     * @notice the maximum between a and b
     * @param a signed integer
     * @param b signed integer
     * @return max of two signed integer
     */
    function max(int256 a, int256 b) internal pure returns (int256) {
        return a > b ? a : b;
    }

    /**
     * @notice Whether `a` is equal to `b`.
     * @param a a signed integer
     * @param b a signed integer
     * @return True if equal, or False.
     */
    function isEqual(int256 a, int256 b) internal pure returns (bool) {
        return a == b;
    }

    /**
     * @notice Whether `a` is greater than `b`.
     * @param a a signed integer
     * @param b a signed integer
     * @return True if `a > b`, or False.
     */
    function isGreaterThan(int256 a, int256 b) internal pure returns (bool) {
        return a > b;
    }

    /**
     * @notice Whether `a` is greater than or equal to `b`.
     * @param a a signed integer
     * @param b a signed integer
     * @return True if `a >= b`, or False.
     */
    function isGreaterThanOrEqual(int256 a, int256 b) internal pure returns (bool) {
        return a >= b;
    }

    /**
     * @notice Whether `a` is less than `b`.
     * @param a a signed integer
     * @param b a signed integer
     * @return True if `a < b`, or False.
     */
    function isLessThan(int256 a, int256 b) internal pure returns (bool) {
        return a < b;
    }

    /**
     * @notice Whether `a` is less than or equal to `b`.
     * @param a a signed integer
     * @param b a signed integer
     * @return True if `a <= b`, or False.
     */
    function isLessThanOrEqual(int256 a, int256 b) internal pure returns (bool) {
        return a <= b;
    }
}
