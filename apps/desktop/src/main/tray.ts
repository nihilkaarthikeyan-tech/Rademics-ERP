import { app, Menu, Tray, nativeImage, type BrowserWindow } from 'electron';

// Branded 32x32 tray icon (Rademics "R" on the login-blue gradient), embedded as
// base64 so it needs no external asset/bundler step. Regenerate via build/icon.png.
const TRAY_ICON =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAADWElEQVR4nO2X2U8TURSH+8A/odBlOsXESAA3RLYBBClQKztl6UQTokYxGoyJViPBImJETIAKRlEIsrSiKGigRRAtAZFFIITNguxuSIyocakcMyROITPlFkx54rzNefm+3vu7955yOGvFUvb7Rj1F5FAZLh+cFMX3GkVxPYDHdgEe0wG4rBXw6BbAo5oAj9SDMKIBhOF1IAzTgTC0GoQhjwDbWwmYtAIwSbkRk5RNYEElpUJxoQcHVUQy2ODkSK6IHAKRfBBE8X2wYviecsAkasCCSwALKgJBYAEIAvJVBJFsY1YAtyZcnA+CgBsg8MtTscLtyWEvq8P980DgpwKef5Y7Q0AkN6hXA87flQU838wS5vLLqcBZH873vQp878sTzBWI/4+0LwfukwF8It3IFIhbJbj3JeATacDcglg0POZsCyiudYNC1QUK1StQ5LTDoQuNEHZCBw7hZRbD+V5KFoEY9C/XPBkDc/XzlxGu3+0GPPAmEs7zTGERkKGXXVM7SgOnP/+A0bez8O3770UiytwmJJzncY5FIBq955raERp0NL1xfs83SIvg4dMhut/aM4WE89zPsAhEoQOnqX2zQOA5vecHUnR0v7P/HRLOczvFIhCJTrtGN0yDEi820IG7db+b7hdUdCLhvJ0nmQJCC46aRmda6gf1BrhS2AZ1L0zbMvVhFlwi8pBwrmsSi0A4+pxrtAbWE/Bnbg6Kq7othnN3HGMRCENfMmrtIA3tH/4EhrEZ+lvfNgIbxZkWwbkuiSwCoegbTq0dMGUgVQuYXzZU1vfTvQpdj0Vw7vbDLAIh6OtVXWMSOKKsnk+7ozQHPs58pfsJp8uQcO62g0wBzIK7XV3TZxI4/5hOe1JaFd1/P/0FHAKUS8K5WxNYBKToh0Vd3btAoIoOnIBQQnOH6Y4ovNe8JNxuy34WAQk1QC79qqXm6UHfPjofuOjjpYsCt5tUgb7VAPqXr+FZywC4SFPMwu2cSeZzjAWrJ5f7pFoauEXwzSTYOceOMwWCSkpXBx4Hto6yOwwBvrjIVRB4e87acDsnGaxzimIOpVRRc7u14baOkdkcc0UQyTbU3G5VOEGY/2Pyr6i5nRqd+T4Z49QAuWK4M2mkAmfrKCtevyncjQasFcdUfwGEg5n9x7zoKgAAAABJRU5ErkJggg==';

export interface AppTray {
  setCheckedIn(checkedIn: boolean): void;
  setUnread(count: number): void;
}

/** The tray icon with a brand-navy dot in the top-right corner — "unread messages". */
function withDot(icon: Electron.NativeImage): Electron.NativeImage {
  const { width, height } = icon.getSize();
  const px = Buffer.from(icon.toBitmap()); // BGRA
  const r = Math.round(width * 0.22);
  const cx = width - r - 1;
  const cy = r + 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > r + 1) continue;
      const i = (y * width + x) * 4;
      // White ring, brand-navy fill — readable on dark and light taskbars alike.
      const [b, g, rr] = d > r - 0.5 ? [255, 255, 255] : [74, 42, 27];
      px[i] = b;
      px[i + 1] = g;
      px[i + 2] = rr;
      px[i + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(px, { width, height });
}

export function createTray(opts: {
  mainWindow: BrowserWindow;
  isQuitting: { value: boolean };
  openChat: () => void;
}): AppTray {
  const icon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON, 'base64'));
  const dotted = withDot(icon);
  const tray = new Tray(icon);
  tray.setToolTip('Rademics Work Monitoring App');
  let checkedIn = false;
  let unread = 0;

  const render = () => {
    const unreadText = unread > 0 ? ` · ${unread} unread message${unread === 1 ? '' : 's'}` : '';
    tray.setToolTip(`Rademics Work Monitoring App — ${checkedIn ? 'checked in' : 'checked out'}${unreadText}`);
    tray.setImage(unread > 0 ? dotted : icon);
    const menu = Menu.buildFromTemplate([
      { label: checkedIn ? 'Checked in' : 'Checked out', enabled: false },
      { type: 'separator' },
      {
        label: unread > 0 ? `Open chat (${unread > 99 ? '99+' : unread} unread)` : 'Open chat',
        click: () => opts.openChat(),
      },
      {
        label: 'Open',
        click: () => {
          if (opts.mainWindow.isMinimized()) opts.mainWindow.restore();
          opts.mainWindow.show();
          opts.mainWindow.focus();
        },
      },
      {
        label: 'Quit',
        click: () => {
          opts.isQuitting.value = true;
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(menu);
  };

  render();
  tray.on('click', () => {
    if (opts.mainWindow.isMinimized()) opts.mainWindow.restore();
    opts.mainWindow.show();
    opts.mainWindow.focus();
  });

  return {
    setCheckedIn: (v) => {
      checkedIn = v;
      render();
    },
    setUnread: (n) => {
      unread = n;
      render();
    },
  };
}
