import { app, Menu, Tray, nativeImage, type BrowserWindow } from 'electron';

// Branded 32x32 tray icon (Rademics "R" on the login-blue gradient), embedded as
// base64 so it needs no external asset/bundler step. Regenerate via build/icon.png.
const TRAY_ICON =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAADWElEQVR4nO2X2U8TURSH+8A/odBlOsXESAA3RLYBBClQKztl6UQTokYxGoyJViPBImJETIAKRlEIsrSiKGigRRAtAZFFIITNguxuSIyocakcMyROITPlFkx54rzNefm+3vu7955yOGvFUvb7Rj1F5FAZLh+cFMX3GkVxPYDHdgEe0wG4rBXw6BbAo5oAj9SDMKIBhOF1IAzTgTC0GoQhjwDbWwmYtAIwSbkRk5RNYEElpUJxoQcHVUQy2ODkSK6IHAKRfBBE8X2wYviecsAkasCCSwALKgJBYAEIAvJVBJFsY1YAtyZcnA+CgBsg8MtTscLtyWEvq8P980DgpwKef5Y7Q0AkN6hXA87flQU838wS5vLLqcBZH873vQp878sTzBWI/4+0LwfukwF8It3IFIhbJbj3JeATacDcglg0POZsCyiudYNC1QUK1StQ5LTDoQuNEHZCBw7hZRbD+V5KFoEY9C/XPBkDc/XzlxGu3+0GPPAmEs7zTGERkKGXXVM7SgOnP/+A0bez8O3770UiytwmJJzncY5FIBq955raERp0NL1xfs83SIvg4dMhut/aM4WE89zPsAhEoQOnqX2zQOA5vecHUnR0v7P/HRLOczvFIhCJTrtGN0yDEi820IG7db+b7hdUdCLhvJ0nmQJCC46aRmda6gf1BrhS2AZ1L0zbMvVhFlwi8pBwrmsSi0A4+pxrtAbWE/Bnbg6Kq7othnN3HGMRCENfMmrtIA3tH/4EhrEZ+lvfNgIbxZkWwbkuiSwCoegbTq0dMGUgVQuYXzZU1vfTvQpdj0Vw7vbDLAIh6OtVXWMSOKKsnk+7ozQHPs58pfsJp8uQcO62g0wBzIK7XV3TZxI4/5hOe1JaFd1/P/0FHAKUS8K5WxNYBKToh0Vd3btAoIoOnIBQQnOH6Y4ovNe8JNxuy34WAQk1QC79qqXm6UHfPjofuOjjpYsCt5tUgb7VAPqXr+FZywC4SFPMwu2cSeZzjAWrJ5f7pFoauEXwzSTYOceOMwWCSkpXBx4Hto6yOwwBvrjIVRB4e87acDsnGaxzimIOpVRRc7u14baOkdkcc0UQyTbU3G5VOEGY/2Pyr6i5nRqd+T4Z49QAuWK4M2mkAmfrKCtevyncjQasFcdUfwGEg5n9x7zoKgAAAABJRU5ErkJggg==';

export interface AppTray {
  setCheckedIn(checkedIn: boolean): void;
}

export function createTray(opts: {
  mainWindow: BrowserWindow;
  isQuitting: { value: boolean };
}): AppTray {
  const icon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON, 'base64'));
  const tray = new Tray(icon);
  tray.setToolTip('Rademics ERP Desktop Agent');

  const render = (checkedIn: boolean) => {
    tray.setToolTip(`Rademics ERP Desktop Agent — ${checkedIn ? 'checked in' : 'checked out'}`);
    const menu = Menu.buildFromTemplate([
      { label: checkedIn ? 'Checked in' : 'Checked out', enabled: false },
      { type: 'separator' },
      {
        label: 'Open',
        click: () => {
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

  render(false);
  tray.on('click', () => {
    opts.mainWindow.show();
    opts.mainWindow.focus();
  });

  return { setCheckedIn: render };
}
