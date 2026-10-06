// Text from chains and dapps can carry invisible or direction-changing characters. The background strips them
// from every decoded request before the approval screen shows it.
import { displaySafe } from "@clip-wallet/core";

const tokenName = "USDC‮​"; // a RIGHT-TO-LEFT OVERRIDE and a zero-width space hidden in a token name
console.log(displaySafe(tokenName)); // "USDC"
console.log(displaySafe("Line one\nLine two")); // line breaks and tabs stay
