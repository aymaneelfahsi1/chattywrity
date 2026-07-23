import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export class StartupManager {
    private appName: string;

    constructor(appName: string) {
        this.appName = appName;
    }

    isEnabled(): boolean {
        if (process.platform === 'linux') {
            return fs.existsSync(this.getLinuxDesktopFilePath());
        }

        return app.getLoginItemSettings().openAtLogin;
    }

    async isEnabledAsync(): Promise<boolean> {
        return this.isEnabled();
    }

    async enable(): Promise<void> {
        if (process.platform === 'linux') {
            const desktopFilePath = this.getLinuxDesktopFilePath();
            fs.mkdirSync(path.dirname(desktopFilePath), { recursive: true });
            fs.writeFileSync(desktopFilePath, this.createLinuxDesktopFile());
            return;
        }

        app.setLoginItemSettings({
            openAtLogin: true,
            path: process.execPath,
            args: app.isPackaged ? [] : [path.join(__dirname, '../../')]
        });
    }

    async disable(): Promise<void> {
        if (process.platform === 'linux') {
            const desktopFilePath = this.getLinuxDesktopFilePath();
            if (fs.existsSync(desktopFilePath)) {
                fs.unlinkSync(desktopFilePath);
            }
            return;
        }

        app.setLoginItemSettings({
            openAtLogin: false
        });
    }

    private getLinuxDesktopFilePath(): string {
        const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
        return path.join(configHome, 'autostart', `${this.appName}.desktop`);
    }

    private createLinuxDesktopFile(): string {
        const execPath = app.isPackaged
            ? process.execPath
            : path.join(__dirname, '../../node_modules/.bin/electron');
        const args = app.isPackaged ? [] : [path.join(__dirname, '../../')];
        const command = [execPath, ...args].map(quoteDesktopValue).join(' ');

        return [
            '[Desktop Entry]',
            'Type=Application',
            `Name=${this.appName}`,
            `Exec=${command}`,
            'Terminal=false',
            'X-GNOME-Autostart-enabled=true',
            ''
        ].join('\n');
    }
}

function quoteDesktopValue(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
