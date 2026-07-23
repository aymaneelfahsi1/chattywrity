import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import { app } from 'electron';
import { ChildProcess, spawn } from 'child_process';

export class Transcriber {
    private modelPath: string;
    private whisperPath: string = '';
    private serverPath: string = '';
    private serverProcess: ChildProcess | null = null;
    private serverPort: number = 0;
    private serverStartupPromise: Promise<void> | null = null;
    private modelName = 'ggml-small.en-q8_0.bin';

    constructor() {
        const resourcesPath = app.isPackaged
            ? path.join(process.resourcesPath, 'models')
            : path.join(__dirname, '../../models');
        this.modelPath = path.join(resourcesPath, this.modelName);
        this.findWhisperExecutable();
    }

    private findWhisperExecutable(): void {
        this.whisperPath = this.findBundledResourceExecutable('whisper-cli');
        this.serverPath = this.findBundledResourceExecutable('whisper-server');

        const nodeModulesPath = app.isPackaged
            ? path.join(process.resourcesPath, 'app.asar.unpacked/node_modules/nodejs-whisper')
            : path.join(__dirname, '../../node_modules/nodejs-whisper');
        const whisperDir = path.join(nodeModulesPath, 'cpp/whisper.cpp');
        const cliNames = process.platform === 'win32'
            ? ['whisper-cli.exe', 'main.exe']
            : ['whisper-cli', 'main'];
        const serverNames = process.platform === 'win32'
            ? ['whisper-server.exe']
            : ['whisper-server'];
        const directories = [
            whisperDir,
            path.join(whisperDir, 'build-cuda/bin'),
            path.join(whisperDir, 'build/bin'),
            path.join(whisperDir, 'build/bin/Release'),
            path.join(whisperDir, 'build/Release')
        ];

        for (const directory of directories) {
            for (const name of cliNames) {
                const candidate = path.join(directory, name);
                if (!this.whisperPath && fs.existsSync(candidate)) {
                    this.whisperPath = candidate;
                    break;
                }
            }

            for (const name of serverNames) {
                const candidate = path.join(directory, name);
                if (!this.serverPath && fs.existsSync(candidate)) {
                    this.serverPath = candidate;
                    break;
                }
            }
        }
    }

    private findBundledResourceExecutable(baseName: string): string {
        const basePath = app.isPackaged
            ? process.resourcesPath
            : path.join(__dirname, '../../resources');
        const platformDir = this.getWhisperPlatformDir();
        const name = process.platform === 'win32' ? `${baseName}.exe` : baseName;
        const candidate = path.join(basePath, 'whisper', platformDir, 'bin', name);

        return fs.existsSync(candidate) ? candidate : '';
    }

    private getWhisperPlatformDir(): string {
        if (process.platform === 'linux' && process.arch === 'x64') {
            return 'linux-x64';
        }

        return `${process.platform}-${process.arch}`;
    }

    async loadModel(): Promise<void> {
        if (!fs.existsSync(this.modelPath)) {
            throw new Error(`Whisper model not found at ${this.modelPath}`);
        }

        if (this.serverPath && fs.existsSync(this.serverPath)) {
            await this.ensureServerStarted();
        }
    }

    async transcribe(audioPath: string): Promise<string> {
        if (!fs.existsSync(this.modelPath)) {
            throw new Error('Whisper model not found');
        }

        if (this.serverPath && fs.existsSync(this.serverPath)) {
            try {
                await this.ensureServerStarted();
                return await this.transcribeWithServer(audioPath);
            } catch (error) {
                this.stopServer();
                if (!this.whisperPath || !fs.existsSync(this.whisperPath)) {
                    throw error;
                }
            }
        }

        if (this.whisperPath && fs.existsSync(this.whisperPath)) {
            return this.transcribeWithExecutable(audioPath);
        }

        throw new Error('Whisper executable not found');
    }

    private async transcribeWithExecutable(audioPath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const args = [
                '-m', this.modelPath,
                '-f', audioPath,
                '-l', 'en',
                '--no-timestamps',
                '-otxt',
                '-t', '6',
                '-p', '1'
            ];
            const child = spawn(this.whisperPath, args, {
                env: this.createWhisperEnvironment(this.whisperPath)
            });
            let output = '';
            let errorOutput = '';

            child.stdout.on('data', data => {
                output += data.toString();
            });

            child.stderr.on('data', data => {
                errorOutput += data.toString();
            });

            child.on('close', code => {
                if (code === 0) {
                    const expectedTxtFile = audioPath + '.txt';
                    let text = output.trim();

                    if (fs.existsSync(expectedTxtFile)) {
                        try {
                            text = fs.readFileSync(expectedTxtFile, 'utf-8').trim();
                            fs.unlinkSync(expectedTxtFile);
                        } catch (e) {
                        }
                    }

                    resolve(text);
                    return;
                }

                reject(new Error(errorOutput.trim() || `Whisper exited with code ${code}`));
            });

            child.on('error', err => {
                reject(err);
            });
        });
    }

    private async ensureServerStarted(): Promise<void> {
        if (this.serverProcess && this.serverPort) {
            return;
        }

        if (this.serverStartupPromise) {
            return this.serverStartupPromise;
        }

        this.serverStartupPromise = this.startServer();
        try {
            await this.serverStartupPromise;
        } finally {
            this.serverStartupPromise = null;
        }
    }

    private async startServer(): Promise<void> {
        this.serverPort = await this.findFreePort();
        const args = [
            '-m', this.modelPath,
            '--host', '127.0.0.1',
            '--port', String(this.serverPort),
            '-l', 'en',
            '--no-timestamps',
            '-t', '2',
            '-p', '1'
        ];
        const child = spawn(this.serverPath, args, {
            env: this.createWhisperEnvironment(this.serverPath),
            stdio: 'ignore'
        });
        this.serverProcess = child;

        child.on('exit', () => {
            if (this.serverProcess === child) {
                this.serverProcess = null;
                this.serverPort = 0;
            }
        });

        await this.waitForServerReady(child, this.serverPort);
    }

    private async transcribeWithServer(audioPath: string): Promise<string> {
        const response = await this.postInference(audioPath);
        const data = JSON.parse(response);
        if (typeof data.text === 'string') {
            return data.text.trim();
        }

        throw new Error('Whisper server returned no text');
    }

    private async postInference(audioPath: string): Promise<string> {
        const boundary = `chattywrity-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const fileBuffer = fs.readFileSync(audioPath);
        const fields = [
            ['temperature', '0.0'],
            ['temperature_inc', '0.2'],
            ['response_format', 'json'],
            ['language', 'en'],
            ['no_timestamps', 'true']
        ];
        const chunks: Buffer[] = [];

        chunks.push(Buffer.from(`--${boundary}\r\n`));
        chunks.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="${path.basename(audioPath)}"\r\n`));
        chunks.push(Buffer.from('Content-Type: audio/wav\r\n\r\n'));
        chunks.push(fileBuffer);
        chunks.push(Buffer.from('\r\n'));

        for (const [name, value] of fields) {
            chunks.push(Buffer.from(`--${boundary}\r\n`));
            chunks.push(Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n`));
            chunks.push(Buffer.from(`${value}\r\n`));
        }

        chunks.push(Buffer.from(`--${boundary}--\r\n`));
        const body = Buffer.concat(chunks);

        return new Promise((resolve, reject) => {
            const request = http.request({
                hostname: '127.0.0.1',
                port: this.serverPort,
                path: '/inference',
                method: 'POST',
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    'Content-Length': body.length
                },
                timeout: 120000
            }, response => {
                const responseChunks: Buffer[] = [];
                response.on('data', chunk => responseChunks.push(Buffer.from(chunk)));
                response.on('end', () => {
                    const text = Buffer.concat(responseChunks).toString('utf-8');
                    if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
                        resolve(text);
                        return;
                    }

                    reject(new Error(text || `Whisper server returned ${response.statusCode}`));
                });
            });

            request.on('timeout', () => {
                request.destroy(new Error('Whisper server request timed out'));
            });
            request.on('error', reject);
            request.end(body);
        });
    }

    private async waitForServerReady(child: ChildProcess, port: number): Promise<void> {
        const startedAt = Date.now();
        while (Date.now() - startedAt < 30000) {
            if (child.exitCode !== null) {
                throw new Error(`Whisper server exited with code ${child.exitCode}`);
            }

            if (await this.canConnect(port)) {
                return;
            }

            await new Promise(resolve => setTimeout(resolve, 200));
        }

        throw new Error('Whisper server did not become ready');
    }

    private canConnect(port: number): Promise<boolean> {
        return new Promise(resolve => {
            const socket = net.createConnection({ host: '127.0.0.1', port });
            socket.once('connect', () => {
                socket.destroy();
                resolve(true);
            });
            socket.once('error', () => {
                resolve(false);
            });
            socket.setTimeout(500, () => {
                socket.destroy();
                resolve(false);
            });
        });
    }

    private findFreePort(): Promise<number> {
        return new Promise((resolve, reject) => {
            const server = net.createServer();
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => {
                const address = server.address();
                server.close(() => {
                    if (address && typeof address === 'object') {
                        resolve(address.port);
                        return;
                    }

                    reject(new Error('Unable to allocate Whisper server port'));
                });
            });
        });
    }

    stopServer(): void {
        if (!this.serverProcess) {
            return;
        }

        const child = this.serverProcess;
        this.serverProcess = null;
        this.serverPort = 0;
        child.kill();
    }

    private createWhisperEnvironment(executablePath: string): NodeJS.ProcessEnv {
        const buildDir = path.dirname(path.dirname(executablePath));
        const resourceLibraryDir = path.join(buildDir, 'lib');
        const libraryDirs = [
            resourceLibraryDir,
            path.join(buildDir, 'src'),
            path.join(buildDir, 'ggml/src'),
            path.join(buildDir, 'ggml/src/ggml-cuda'),
            '/usr/local/cuda-12.6/targets/x86_64-linux/lib',
            '/usr/local/cuda/targets/x86_64-linux/lib',
            '/usr/local/cuda-12.6/lib64',
            '/usr/local/cuda/lib64'
        ];
        const existingLibraryPath = process.env.LD_LIBRARY_PATH || '';
        const ldLibraryPath = [...libraryDirs.filter(directory => fs.existsSync(directory)), existingLibraryPath].filter(Boolean).join(path.delimiter);

        return {
            ...process.env,
            LD_LIBRARY_PATH: ldLibraryPath
        };
    }
}
