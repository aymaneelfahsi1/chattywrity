import { clipboard } from 'electron';
import { execFile } from 'child_process';

export type InjectionMode = 'pasted' | 'copied';

export class TextInjector {
    async type(text: string): Promise<InjectionMode> {
        if (!text || text.trim().length === 0) {
            return 'copied';
        }

        const cleanText = text.trim();
        clipboard.writeText(cleanText);
        await this.delay(80);

        if (await this.tryPaste()) {
            return 'pasted';
        }

        return 'copied';
    }

    private async tryPaste(): Promise<boolean> {
        const commands = this.getPasteCommands();

        for (const command of commands) {
            if (await this.run(command.bin, command.args)) {
                return true;
            }
        }

        return false;
    }

    private getPasteCommands(): Array<{ bin: string; args: string[] }> {
        if (process.platform === 'darwin') {
            return [{ bin: 'osascript', args: ['-e', 'tell application "System Events" to keystroke "v" using command down'] }];
        }

        if (process.platform === 'win32') {
            return [];
        }

        const commands: Array<{ bin: string; args: string[] }> = [];

        if (process.env.WAYLAND_DISPLAY) {
            commands.push({ bin: 'wtype', args: ['-M', 'ctrl', 'v', '-m', 'ctrl'] });
            commands.push({ bin: 'ydotool', args: ['key', '29:1', '47:1', '47:0', '29:0'] });
        }

        if (process.env.DISPLAY) {
            commands.push({ bin: 'xdotool', args: ['key', 'ctrl+v'] });
        }

        return commands;
    }

    private run(bin: string, args: string[]): Promise<boolean> {
        return new Promise(resolve => {
            const child = execFile(bin, args, { timeout: 1000 }, error => {
                resolve(!error);
            });

            child.on('error', () => resolve(false));
        });
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
