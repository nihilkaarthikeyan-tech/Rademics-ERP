import { app, Menu, Tray, nativeImage, type BrowserWindow } from 'electron';

// 1x1 transparent PNG placeholder — swap for a real branded 16x16/32x32 icon
// asset before shipping. Functionality (menu, status label) doesn't depend on it.
const PLACEHOLDER_ICON =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

export interface AppTray {
  setCheckedIn(checkedIn: boolean): void;
}

export function createTray(opts: {
  mainWindow: BrowserWindow;
  isQuitting: { value: boolean };
}): AppTray {
  const icon = nativeImage.createFromBuffer(Buffer.from(PLACEHOLDER_ICON, 'base64'));
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
