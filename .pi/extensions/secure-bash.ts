import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
// The implementation is shared with Electron's SDK integration and is loaded
// directly by Pi's TypeScript extension loader at runtime.
// @ts-expect-error JavaScript module has no generated declaration file.
import { createSecureBashTool } from "../../electron/overlay-tooling.mjs";

/**
 * Replaces only Pi's agent-facing bash tool. Pi's interactive ! and !! user
 * commands are deliberately left on Pi's original user_bash path.
 */
export default function secureBashExtension(pi: ExtensionAPI) {
  pi.registerTool(createSecureBashTool(process.cwd()));
}
