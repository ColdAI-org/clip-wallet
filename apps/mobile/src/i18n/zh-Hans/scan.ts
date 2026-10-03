import type en from "../en/scan";
export default {
  "m.scan.title": "扫码连接",
  "m.scan.allowCamera": "允许使用摄像头",
  "m.scan.cameraWhy": "摄像头仅用于读取连接代码。你也可以改为在“设置”中粘贴代码。",
  "m.scan.point": "将摄像头对准应用的二维码。",
  "m.scan.notWalletConnect": "这个二维码不是 {wc} 代码。",
  "m.scan.found": "已识别，正在连接…",
  "m.scan.pairing": "已开始配对。应用会请你确认连接。",
} satisfies Record<keyof typeof en, string>;
