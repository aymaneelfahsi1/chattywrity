import { spawn, ChildProcess, execFileSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const ffmpegPath = resolveFfmpegPath();

export enum AppState {
    IDLE = 'idle',
    STARTING = 'starting',
    RECORDING = 'recording',
    PROCESSING = 'processing',
    TYPING = 'typing'
}

export type SilenceReason = 'post-speech';

export class StateManager {
    private state: AppState = AppState.IDLE;
    private recordingProcess: ChildProcess | null = null;
    private audioFilePath: string = '';
    private microphoneName: string = '';
    public onSilence: ((reason: SilenceReason) => void) | null = null;

    constructor() {
        this.detectMicrophone();
    }

    private detectMicrophone(): void {
        if (process.platform !== 'win32') {
            this.microphoneName = process.env.CHATTYWRITY_AUDIO_SOURCE || this.findLinuxMicrophone();
            return;
        }

        try {
            const result = execFileSync(ffmpegPath, ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], {
                encoding: 'utf8',
                timeout: 5000,
                stdio: ['ignore', 'pipe', 'pipe']
            }).toString();

            this.microphoneName = this.extractWindowsMicrophone(result);
        } catch (error) {
            const output = (error as any).stdout?.toString() || (error as any).stderr?.toString() || '';
            this.microphoneName = this.extractWindowsMicrophone(output);
        }
    }

    private extractWindowsMicrophone(output: string): string {
        const audioMatches = [...output.matchAll(/"([^"]+)"\s*\(audio\)/g)];

        if (audioMatches.length === 0) {
            return 'Microphone';
        }

        const names = audioMatches.map(m => m[1]);
        return names.find(n => n.includes('Realtek')) || names[0];
    }

    private findLinuxMicrophone(): string {
        if (process.env.CHATTYWRITY_USE_EASYEFFECTS !== '0') {
            const existingSource = this.findPulseSource('easyeffects_source');
            if (existingSource) {
                return existingSource;
            }

            this.startEasyEffects();
            const startedSource = this.waitForPulseSource('easyeffects_source', 4000);
            if (startedSource) {
                return startedSource;
            }
        }

        return 'default';
    }

    private findPulseSource(sourceName: string): string | null {
        try {
            const result = execFileSync('pactl', ['list', 'short', 'sources'], {
                encoding: 'utf8',
                timeout: 2000,
                stdio: ['ignore', 'pipe', 'pipe']
            }).toString();
            const sources = result.split('\n')
                .map(line => line.split('\t')[1])
                .filter(Boolean);
            return sources.find(source => source === sourceName) || null;
        } catch (error) {
            return null;
        }
    }

    private waitForPulseSource(sourceName: string, timeoutMs: number): string | null {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            const source = this.findPulseSource(sourceName);
            if (source) {
                return source;
            }

            this.sleep(200);
        }

        return null;
    }

    private startEasyEffects(): void {
        const executable = findExecutable('easyeffects');
        if (!executable) {
            return;
        }

        try {
            const child = spawn(executable, ['--service-mode', '--hide-window'], {
                detached: true,
                stdio: 'ignore'
            });
            child.unref();
        } catch (error) {
        }
    }

    private sleep(milliseconds: number): void {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
    }

    getState(): AppState {
        return this.state;
    }

    setState(newState: AppState): void {
        this.debug(`state ${this.state} -> ${newState}`);
        this.state = newState;
    }

    async startRecording(): Promise<void> {
        return new Promise((resolve, reject) => {
            const tempDir = os.tmpdir();
            this.audioFilePath = path.join(tempDir, `chattywrity_${Date.now()}.wav`);
            this.debug(`recording to ${this.audioFilePath}`);
            this.recordingProcess = spawn(ffmpegPath, this.createRecordingArgs(), {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let started = false;

            const finishStart = () => {
                if (!started) {
                    started = true;
                    resolve();
                }
            };

            const onData = (data: Buffer) => {
                const text = data.toString();

                if (text.includes('Output #0') || text.includes('size=')) {
                    finishStart();
                }

                const silenceMatch = text.match(/silence_start:\s*(\d+(\.\d+)?)/);
                if (silenceMatch) {
                    const silenceTime = parseFloat(silenceMatch[1]);
                    this.debug(`silence_start ${silenceTime}`);
                    if (silenceTime >= 0.5 && this.onSilence) {
                        this.onSilence('post-speech');
                    }
                }
            };

            this.recordingProcess.stderr?.on('data', onData);

            this.recordingProcess.on('error', err => {
                this.debug(`ffmpeg error ${err.message}`);
                if (!started) {
                    started = true;
                    reject(err);
                }
            });

            this.recordingProcess.on('exit', code => {
                this.debug(`ffmpeg exit ${code}`);
                if (!started && code !== 0) {
                    started = true;
                    reject(new Error(`FFmpeg exited with code ${code}`));
                }
            });

            setTimeout(finishStart, 1500);
        });
    }

    async stopRecording(): Promise<string> {
        return new Promise((resolve, reject) => {
            if (!this.recordingProcess) {
                reject(new Error('No recording in progress'));
                return;
            }

            let settled = false;

            const finish = () => {
                if (settled) {
                    return;
                }

                settled = true;
                const filePath = this.audioFilePath;
                this.recordingProcess = null;

                setTimeout(() => {
                    if (!fs.existsSync(filePath)) {
                        reject(new Error('Audio file not created'));
                        return;
                    }

                    const stats = fs.statSync(filePath);

                    if (stats.size < 6000) {
                        reject(new Error('Audio too short'));
                    } else {
                        resolve(filePath);
                    }
                }, 300);
            };

            if (this.recordingProcess.stdin?.writable) {
                this.recordingProcess.stdin.write('q');
            }

            this.recordingProcess.once('close', finish);

            setTimeout(() => {
                if (this.recordingProcess) {
                    this.recordingProcess.kill('SIGTERM');
                    finish();
                }
            }, 2000);
        });
    }

    cancelRecording(): void {
        if (this.recordingProcess) {
            try {
                this.recordingProcess.kill('SIGKILL');
            } catch (e) {
            }
            this.recordingProcess = null;
        }

        if (this.audioFilePath && fs.existsSync(this.audioFilePath)) {
            try {
                fs.unlinkSync(this.audioFilePath);
            } catch (e) {
            }
        }

        this.state = AppState.IDLE;
    }

    private createRecordingArgs(): string[] {
        const commonArgs = [
            '-y',
            '-af', this.createSilenceFilter(),
            '-ar', '16000',
            '-ac', '1',
            '-fflags', 'nobuffer',
            '-flags', 'low_delay',
            '-analyzeduration', '0',
            '-probesize', '32',
            this.audioFilePath
        ];

        if (process.platform === 'win32') {
            return [
                '-f', 'dshow',
                '-i', `audio=${this.microphoneName}`,
                '-audio_buffer_size', '0',
                ...commonArgs
            ];
        }

        if (process.platform === 'darwin') {
            return [
                '-f', 'avfoundation',
                '-i', process.env.CHATTYWRITY_AUDIO_SOURCE || ':0',
                ...commonArgs
            ];
        }

        return [
            '-f', 'pulse',
            '-i', this.microphoneName,
            ...commonArgs
        ];
    }

    private createSilenceFilter(): string {
        const noise = process.env.CHATTYWRITY_SILENCE_NOISE || '-30dB';
        const duration = process.env.CHATTYWRITY_SILENCE_DURATION || '2.0';
        this.debug(`silence filter noise=${noise} duration=${duration}`);
        return `silencedetect=noise=${noise}:d=${duration}`;
    }

    private debug(message: string): void {
    }
}

function resolveFfmpegPath(): string {
    if (process.platform === 'linux') {
        const systemPath = findExecutable('ffmpeg');
        if (systemPath) {
            return systemPath;
        }
    }

    return findOptionalFfmpegStatic() || 'ffmpeg';
}

function findExecutable(name: string): string | null {
    const pathValue = process.env.PATH || '';
    const directories = pathValue.split(path.delimiter).filter(Boolean);

    for (const directory of directories) {
        const candidate = path.join(directory, name);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}

function findOptionalFfmpegStatic(): string | null {
    try {
        const ffmpegStatic = require('ffmpeg-static') as string | null;
        return ffmpegStatic?.replace('app.asar', 'app.asar.unpacked') || null;
    } catch (error) {
        return null;
    }
}
