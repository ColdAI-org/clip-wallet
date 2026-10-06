/* Native modules have no JS implementation under jest: replace them with inert stand-ins. */
jest.mock("react-native-safe-area-context", () => require("react-native-safe-area-context/jest/mock").default);
jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 7,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
  canUseBiometricAuthentication: () => true,
}));
jest.mock("expo-local-authentication", () => ({
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
  hasHardwareAsync: async () => true,
  isEnrolledAsync: async () => true,
  supportedAuthenticationTypesAsync: async () => [2],
  authenticateAsync: async () => ({ success: true }),
}));
jest.mock("expo-device", () => ({ isDevice: false, osName: "iOS" }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => true) }));
// The camera: tests read the last CameraView's props (globalThis.__camera) to feed it scanned QR texts.
jest.mock("expo-camera", () => ({
  CameraView: (props) => {
    globalThis.__camera = props;
    return null;
  },
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "dismiss" })), WebBrowserPresentationStyle: { PAGE_SHEET: "pageSheet" } }));
jest.mock("@ledgerhq/react-native-hw-transport-ble", () => ({ __esModule: true, default: {} }));
jest.mock("react-native-ble-plx", () => ({}));
jest.mock("react-native-webview", () => {
  const { View } = require("react-native");
  return { WebView: View };
});
jest.mock("react-native-passkey", () => ({ Passkey: { isSupported: () => false } }));
jest.mock("expo-linking", () => ({ __esModule: true, getInitialURL: jest.fn(async () => null), addEventListener: () => ({ remove() {} }) }));
jest.mock("expo-status-bar", () => ({ StatusBar: () => null }));
jest.mock("expo-notifications", () => ({
  AndroidImportance: { DEFAULT: 3 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove() {} })),
}));
