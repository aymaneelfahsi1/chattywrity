import { spawn, ChildProcess, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { app } from 'electron';
import ffmpegStatic from 'ffmpeg-static';

const ffmpegPath = ffmpegStatic?.replace('app.asar', 'app.asar.unpacked') || 'ffmpeg';

export enum AppState {
    IDLE = 'idle',
    STARTING = 'starting',
    RECORDING = 'recording',
    PROCESSING = 'processing',
    TYPING = 'typing'
}

export class StateManager {
    private state: AppState = AppState.IDLE;
    private recordingProcess: ChildProcess | null = null;
    private audioFilePath: string = '';
    private microphoneName: string = '';
    public onSilence: (() => void) | null = null;

    constructor() {
        this.detectMicrophone();
    }

    private detectMicrophone(): void {
        try {
            const command = `chcp 65001 && "${ffmpegPath}" -list_devices true -f dshow -i dummy 2>&1`;
            const result = execSync(command, {
                encoding: 'utf8',
                timeout: 5000,
                stdio: ['ignore', 'pipe', 'pipe']
            }).toString();

            const audioMatches = [...result.matchAll(/"([^"]+)"\s*\(audio\)/g)];

            if (audioMatches.length > 0) {
                const names = audioMatches.map(m => m[1]);
                const preferred = names.find(n => n.includes('Realtek')) || names[0];
                this.microphoneName = preferred;
            } else {
                this.microphoneName = 'Microphone';
            }
        } catch (error) {
            const output = (error as any).stdout?.toString() || (error as any).stderr?.toString() || '';
            const audioMatches = [...output.matchAll(/"([^"]+)"\s*\(audio\)/g)];

            if (audioMatches.length > 0) {
                const names = audioMatches.map(m => m[1]);
                const preferred = names.find(n => n.includes('Realtek')) || names[0];
                this.microphoneName = preferred;
            } else {
                this.microphoneName = 'Microphone';
            }
        }
    }

    getState(): AppState {
        return this.state;
    }

    setState(newState: AppState): void {
        this.state = newState;
    }

    async startRecording(): Promise<void> {
        return new Promise((resolve, reject) => {
            const tempDir = os.tmpdir();
            this.audioFilePath = path.join(tempDir, `chattywrity_${Date.now()}.wav`);

            this.recordingProcess = spawn(ffmpegPath, [
                '-f', 'dshow',
                '-i', `audio=${this.microphoneName}`,
                '-y',
                '-af', 'silencedetect=noise=-30dB:d=2.0',
                '-ar', '16000',
                '-ac', '1',
                '-fflags', 'nobuffer',
                '-flags', 'low_delay',
                '-analyzeduration', '0',
                '-probesize', '32',
                '-audio_buffer_size', '0',
                this.audioFilePath
            ], {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let started = false;

            const onData = (data: Buffer) => {
                const text = data.toString();

                if (!started && (text.includes('Output #0') || text.includes('size='))) {
                    started = true;
                    resolve();
                }

                const silenceMatch = text.match(/silence_start:\s*(\d+(\.\d+)?)/);
                if (silenceMatch) {
                    const silenceTime = parseFloat(silenceMatch[1]);
                    if (silenceTime >= 0.5) {
                        if (this.onSilence) {
                            this.onSilence();
                        }
                    }
                }
            };

            this.recordingProcess.stderr?.on('data', onData);

            this.recordingProcess.on('error', (err) => {
                if (!started) {
                    started = true;
                    reject(err);
                }
            });

            setTimeout(() => {
                if (!started) {
                    started = true;
                    resolve();
                }
            }, 1500);
        });
    }

    async stopRecording(): Promise<string> {
        return new Promise((resolve, reject) => {
            if (!this.recordingProcess) {
                reject(new Error('No recording in progress'));
                return;
            }

            if (this.recordingProcess.stdin?.writable) {
                this.recordingProcess.stdin.write('q');
            }

            const cleanup = () => {
                setTimeout(() => {
                    if (fs.existsSync(this.audioFilePath)) {
                        const stats = fs.statSync(this.audioFilePath);

                        if (stats.size < 6000) {
                            reject(new Error('Audio too short'));
                        } else {
                            resolve(this.audioFilePath);
                        }
                    } else {
                        reject(new Error('Audio file not created'));
                    }
                }, 500);
            };

            this.recordingProcess.on('close', cleanup);

            setTimeout(() => {
                if (this.recordingProcess) {
                    try {
                        this.recordingProcess.kill('SIGTERM');
                    } catch (e) { }
                    cleanup();
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
}