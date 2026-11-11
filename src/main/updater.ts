import { app, ipcMain, type BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
import type { UpdateProgress } from "../shared/types.js";

// shortcut: checks once at startup only, no periodic polling — add a timer if sessions run for days.
export const initUpdater = (getWindow: () => BrowserWindow | null) => {
  // Dev builds have no app-update.yml; the portable exe cannot self-replace.
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_FILE) return;

  const { autoUpdater } = electronUpdater;
  autoUpdater.autoDownload = false; // download only after the user confirms
  let pendingVersion: string | null = null;

  const send = (channel: string, payload: unknown) =>
    getWindow()?.webContents.send(channel, payload);

  autoUpdater.on("update-available", ({ version }) => {
    pendingVersion = version;
    send("update:available", { version });
  });
  autoUpdater.on("download-progress", (p) =>
    send("update:progress", {
      percent: p.percent,
      transferred: p.transferred,
      total: p.total,
    } satisfies UpdateProgress),
  );
  // Closes the app and launches the NSIS setup.
  autoUpdater.on("update-downloaded", () =>
    autoUpdater.quitAndInstall(false, true),
  );
  autoUpdater.on("error", (err) =>
    send("update:error", { message: err.message }),
  );

  // The renderer may mount after the (fast) check resolved: let it ask for the state.
  ipcMain.handle("update:pending", () => pendingVersion);
  ipcMain.handle("update:download", () =>
    autoUpdater.downloadUpdate().then(() => undefined),
  );

  autoUpdater.checkForUpdates().catch((err: Error) => {
    console.warn("[Updater] check failed:", err.message);
  });
};
