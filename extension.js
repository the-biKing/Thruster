const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const os = require('os');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

let terminalInstance = null;
let isMonitoring = false;
let boardStatusBarItem = null;
let portStatusBarItem = null;
let initStatusBarItem = null;
let settingsPanel = null;

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

const DEFAULT_CLI_PATH = isWin
    ? "G:\\Arduino\\Arduino IDE\\resources\\app\\lib\\backend\\resources\\arduino-cli.exe"
    : (isMac ? "/opt/homebrew/bin/arduino-cli" : "/usr/local/bin/arduino-cli");

const POPULAR_BOARDS = [
    { label: "NodeMCU-32S (ESP32)", fqbn: "esp32:esp32:nodemcu-32s", description: "Default NodeMCU ESP32-S (Xtensa Dual-Core)" },
    { label: "ESP32 Dev Module", fqbn: "esp32:esp32:esp32", description: "Generic ESP-WROOM-32" },
    { label: "ESP32-S3 Dev Module", fqbn: "esp32:esp32:esp32s3", description: "ESP32-S3 Dual-Core (USB OTG / Native USB)" },
    { label: "Nologo ESP32-C3 SuperMini", fqbn: "esp32:esp32:nologo_esp32c3_super_mini", description: "Super Mini RISC-V Board (Native USB)" },
    { label: "NodeMCU 1.0 (ESP-12E Module)", fqbn: "esp8266:esp8266:nodemcuv2", description: "ESP8266 WiFi Board" },
    { label: "Generic ESP8266 Module", fqbn: "esp8266:esp8266:generic", description: "ESP8266 Standard Core" },
    { label: "Arduino Uno R3", fqbn: "arduino:avr:uno", description: "Classic ATmega328P Uno" },
    { label: "Arduino Nano", fqbn: "arduino:avr:nano", description: "Classic ATmega328P Nano" },
    { label: "Arduino Mega or Mega 2560", fqbn: "arduino:avr:mega", description: "ATmega2560 High I/O Board" },
    { label: "Arduino Uno R4 Minima", fqbn: "arduino:renesas_uno:minima", description: "Renesas RA4M1 32-bit Cortex-M4" },
    { label: "Arduino Uno R4 WiFi", fqbn: "arduino:renesas_uno:unor4wifi", description: "Renesas RA4M1 + ESP32-S3 WiFi" },
    { label: "Arduino Uno WiFi Rev2", fqbn: "arduino:megaavr:uno2018", description: "ATmega4809 with WiFi" },
    { label: "Arduino Due (Programming Port)", fqbn: "arduino:sam:arduino_due_x", description: "Atmel SAM3X8E ARM Cortex-M3 (Prog Port)" },
    { label: "Arduino Due (Native USB)", fqbn: "arduino:sam:arduino_due_x_dbg", description: "Atmel SAM3X8E (Native USB Port)" },
    { label: "Raspberry Pi Pico (RP2040)", fqbn: "rp2040:rp2040:rpipico", description: "RP2040 Dual ARM Cortex-M0+" },
    { label: "Raspberry Pi Pico 2 (RP2350)", fqbn: "rp2040:rp2040:rpipico2", description: "RP2350 Dual Hazard3 RISC-V / Cortex-M33" },
    { label: "Generic STM32F1 series (BluePill)", fqbn: "STMicroelectronics:stm32:GenF1", description: "STM32F103 ARM Cortex-M3" },
    { label: "🔍 Search All Installed Boards...", fqbn: "search_installed", description: "Search any board installed in Arduino IDE / CLI" },
    { label: "Custom FQBN...", fqbn: "custom", description: "Specify a custom Fully Qualified Board Name" }
];

const KNOWN_CORE_INDEX_URLS = {
    'esp32:esp32': 'https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json',
    'esp8266:esp8266': 'https://arduino.esp8266.com/stable/package_esp8266com_index.json',
    'rp2040:rp2040': 'https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json',
    'STMicroelectronics:stm32': 'https://github.com/stm32duino/BoardManagerFiles/raw/main/package_stmicroelectronics_index.json'
};

const BUILTIN_HEADERS = new Set([
    'stdio', 'stdlib', 'stdint', 'stdbool', 'stddef', 'math', 'string', 'time',
    'vector', 'map', 'set', 'string_view', 'algorithm', 'memory', 'utility',
    'iostream', 'sstream', 'fstream', 'cstddef', 'cstdint', 'cstring', 'cmath'
]);

function sendTerminalEcho(term, message, color = 'cyan') {
    if (isWin) {
        const colorMap = {
            cyan: 'Cyan',
            green: 'Green',
            yellow: 'Yellow',
            red: 'Red',
            magenta: 'Magenta',
            white: 'White'
        };
        const fg = colorMap[color] || 'Cyan';
        term.sendText(`Write-Host "${message}" -ForegroundColor ${fg}`);
    } else {
        const ansiMap = {
            cyan: '\\033[1;36m',
            green: '\\033[1;32m',
            yellow: '\\033[1;33m',
            red: '\\033[1;31m',
            magenta: '\\033[1;35m',
            white: '\\033[1;37m'
        };
        const ansi = ansiMap[color] || '\\033[1;36m';
        term.sendText(`printf "${ansi}%s\\033[0m\\n" "${message}"`);
    }
}

function formatCliCmd(cliPath, args) {
    if (isWin) {
        return `& "${cliPath}" ${args}`;
    }
    return `"${cliPath}" ${args}`;
}

function getWorkspaceRoot() {
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        return vscode.workspace.workspaceFolders[0].uri.fsPath;
    }
    return null;
}

function getConfigPath() {
    const root = getWorkspaceRoot();
    if (!root) return null;
    return path.join(root, '.vscode', 'arduino.json');
}

function loadConfig() {
    const p = getConfigPath();
    if (p && fs.existsSync(p)) {
        try {
            return JSON.parse(fs.readFileSync(p, 'utf8'));
        } catch (e) {
            console.error("Error reading arduino.json", e);
        }
    }
    return null;
}

function saveConfig(data) {
    const root = getWorkspaceRoot();
    if (!root) return false;
    const vscodeDir = path.join(root, '.vscode');
    if (!fs.existsSync(vscodeDir)) {
        fs.mkdirSync(vscodeDir, { recursive: true });
    }
    const current = loadConfig() || {};
    const merged = Object.assign({}, current, data);
    fs.writeFileSync(getConfigPath(), JSON.stringify(merged, null, 2), 'utf8');
    return true;
}

function checkBinaryRunnable(binaryPath) {
    if (!binaryPath) return false;
    try {
        const cmd = binaryPath === 'arduino-cli' ? 'arduino-cli version' : `"${binaryPath}" version`;
        const out = cp.execSync(cmd, { encoding: 'utf8', timeout: 6000, stdio: ['ignore', 'pipe', 'ignore'] });
        return typeof out === 'string' && out.toLowerCase().includes('arduino-cli');
    } catch (e) {
        return false;
    }
}

function getBinaryVersion(binaryPath) {
    if (!binaryPath) return '';
    try {
        const cmd = binaryPath === 'arduino-cli' ? 'arduino-cli version' : `"${binaryPath}" version`;
        const out = cp.execSync(cmd, { encoding: 'utf8', timeout: 6000, stdio: ['ignore', 'pipe', 'ignore'] });
        return (out || '').trim().split('\n')[0];
    } catch (e) {
        return '';
    }
}

function resolveArduinoCliPath() {
    // 1. Check workspace config (.vscode/arduino.json)
    const config = loadConfig();
    if (config && config.arduinoCliPath) {
        const trimmed = String(config.arduinoCliPath).trim();
        if (trimmed && fs.existsSync(trimmed) && checkBinaryRunnable(trimmed)) {
            return trimmed;
        }
    }

    // 2. Check VS Code settings (thruster.arduinoCliPath)
    const vsSettings = vscode.workspace.getConfiguration('thruster');
    const settingsPath = vsSettings.get('arduinoCliPath');
    if (settingsPath && typeof settingsPath === 'string' && settingsPath.trim()) {
        const trimmed = settingsPath.trim();
        if (fs.existsSync(trimmed) && checkBinaryRunnable(trimmed)) {
            return trimmed;
        }
    }

    // 3. Check system PATH
    if (checkBinaryRunnable('arduino-cli')) {
        return 'arduino-cli';
    }

    // 4. Candidate locations by platform
    const binName = isWin ? 'arduino-cli.exe' : 'arduino-cli';
    const home = os.homedir();

    const candidates = [
        path.join(home, '.thruster', 'bin', binName)
    ];

    if (isWin) {
        const localApp = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
        const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
        const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

        candidates.push(
            path.join(localApp, 'Programs', 'Arduino IDE', 'resources', 'app', 'lib', 'backend', 'resources', 'arduino-cli.exe'),
            path.join(progFiles, 'Arduino IDE', 'resources', 'app', 'lib', 'backend', 'resources', 'arduino-cli.exe'),
            path.join(progFilesX86, 'Arduino IDE', 'resources', 'app', 'lib', 'backend', 'resources', 'arduino-cli.exe'),
            path.join(localApp, 'Arduino15', 'bin', 'arduino-cli.exe'),
            path.join(localApp, 'Arduino15', 'arduino-cli.exe'),
            path.join(home, 'bin', 'arduino-cli.exe'),
            path.join(home, 'arduino-cli', 'arduino-cli.exe'),
            DEFAULT_CLI_PATH
        );
    } else if (isMac) {
        candidates.push(
            path.join(home, '.thruster', 'bin', 'arduino-cli'),
            '/opt/homebrew/bin/arduino-cli',
            '/opt/homebrew/sbin/arduino-cli',
            '/usr/local/bin/arduino-cli',
            '/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli',
            path.join(home, 'Applications', 'Arduino IDE.app', 'Contents', 'Resources', 'app', 'lib', 'backend', 'resources', 'arduino-cli'),
            path.join(home, 'bin', 'arduino-cli'),
            path.join(home, 'Library', 'Arduino15', 'bin', 'arduino-cli'),
            path.join(home, '.local', 'bin', 'arduino-cli'),
            '/usr/bin/arduino-cli'
        );
    } else {
        candidates.push(
            path.join(home, '.thruster', 'bin', 'arduino-cli'),
            '/usr/local/bin/arduino-cli',
            '/usr/bin/arduino-cli',
            path.join(home, '.local', 'bin', 'arduino-cli'),
            path.join(home, 'bin', 'arduino-cli'),
            path.join(home, '.arduino15', 'bin', 'arduino-cli')
        );
    }

    for (const c of candidates) {
        if (c && fs.existsSync(c) && checkBinaryRunnable(c)) {
            return c;
        }
    }

    return null;
}

function getCliPath() {
    return resolveArduinoCliPath() || 'arduino-cli';
}

function downloadFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        const request = (targetUrl) => {
            const client = targetUrl.startsWith('https') ? https : http;
            client.get(targetUrl, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.resume();
                    return request(res.headers.location);
                }
                if (res.statusCode !== 200) {
                    file.close();
                    fs.unlink(destPath, () => {});
                    return reject(new Error(`Download failed with HTTP ${res.statusCode}`));
                }

                const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
                let receivedBytes = 0;

                res.on('data', (chunk) => {
                    receivedBytes += chunk.length;
                    if (onProgress && totalBytes > 0) {
                        onProgress(receivedBytes, totalBytes);
                    }
                });

                res.pipe(file);
                file.on('finish', () => {
                    file.close(() => resolve(destPath));
                });
            }).on('error', (err) => {
                file.close();
                fs.unlink(destPath, () => {});
                reject(err);
            });
        };
        request(url);
    });
}

function extractArchive(archivePath, targetDir) {
    if (isWin) {
        const psCmd = `Expand-Archive -Path '${archivePath}' -DestinationPath '${targetDir}' -Force`;
        cp.execSync(`powershell -NoProfile -NonInteractive -Command "${psCmd}"`, { encoding: 'utf8', timeout: 120000 });
    } else {
        cp.execSync(`tar -xzf "${archivePath}" -C "${targetDir}"`, { encoding: 'utf8', timeout: 120000 });
    }
}

async function installArduinoCliOneClick() {
    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Thruster: Installing official arduino-cli...",
        cancellable: false
    }, async (progress) => {
        try {
            const installDir = path.join(os.homedir(), '.thruster', 'bin');
            if (!fs.existsSync(installDir)) {
                fs.mkdirSync(installDir, { recursive: true });
            }

            const isArm = process.arch === 'arm64';
            const binName = isWin ? 'arduino-cli.exe' : 'arduino-cli';
            const targetExe = path.join(installDir, binName);

            let downloadUrl = '';
            let archiveExt = '.zip';

            if (isWin) {
                downloadUrl = process.arch === 'ia32'
                    ? 'https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_Windows_32bit.zip'
                    : 'https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_Windows_64bit.zip';
                archiveExt = '.zip';
            } else if (isMac) {
                downloadUrl = isArm
                    ? 'https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_macOS_ARM64.tar.gz'
                    : 'https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_macOS_64bit.tar.gz';
                archiveExt = '.tar.gz';
            } else {
                downloadUrl = isArm
                    ? 'https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_Linux_ARM64.tar.gz'
                    : 'https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_Linux_64bit.tar.gz';
                archiveExt = '.tar.gz';
            }

            const tempArchive = path.join(os.tmpdir(), `thruster_arduino_cli_${Date.now()}${archiveExt}`);

            progress.report({ message: "Connecting to Arduino download servers..." });
            const term = getTerminal();
            term.show(true);
            sendTerminalEcho(term, `=== Thruster: Downloading official arduino-cli from ${downloadUrl}... ===`, 'cyan');

            await downloadFile(downloadUrl, tempArchive, (received, total) => {
                if (total > 0) {
                    const percent = Math.round((received / total) * 100);
                    const mbReceived = (received / (1024 * 1024)).toFixed(1);
                    const mbTotal = (total / (1024 * 1024)).toFixed(1);
                    progress.report({ message: `Downloading arduino-cli: ${percent}% (${mbReceived} MB / ${mbTotal} MB)...` });
                }
            });

            progress.report({ message: "Extracting arduino-cli binary..." });
            sendTerminalEcho(term, `=== Thruster: Extracting to ${installDir}... ===`, 'cyan');
            extractArchive(tempArchive, installDir);
            try { fs.unlinkSync(tempArchive); } catch (e) {}

            if (!isWin) {
                try { fs.chmodSync(targetExe, 0o755); } catch (e) {}
            }

            progress.report({ message: "Verifying binary installation..." });
            if (!checkBinaryRunnable(targetExe)) {
                throw new Error(`Downloaded binary at "${targetExe}" could not be executed.`);
            }

            // Update configuration
            await vscode.workspace.getConfiguration('thruster').update('arduinoCliPath', targetExe, vscode.ConfigurationTarget.Global);
            if (loadConfig()) {
                saveConfig({ arduinoCliPath: targetExe });
            }

            progress.report({ message: "Updating Arduino package index..." });
            sendTerminalEcho(term, `=== Thruster: Updating package index via arduino-cli... ===`, 'cyan');
            try {
                cp.execSync(`"${targetExe}" core update-index`, { encoding: 'utf8', timeout: 35000 });
            } catch (e) {}

            sendTerminalEcho(term, `=== Thruster: arduino-cli setup successfully completed! ===`, 'green');
            vscode.window.showInformationMessage(`Thruster: arduino-cli successfully installed to ${targetExe}`);

            if (settingsPanel) {
                settingsPanel.webview.html = getSettingsWebviewHtml(getSystemHealthState());
            }

            return targetExe;
        } catch (err) {
            vscode.window.showErrorMessage(`Thruster: Failed to auto-install arduino-cli: ${err.message}. You can manually download it or point to an existing path.`);
            return null;
        }
    });
}

async function promptLocateArduinoCli() {
    const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: "Select arduino-cli executable",
        title: "Locate arduino-cli Executable",
        filters: isWin ? { 'Executables (*.exe)': ['exe'], 'All Files (*.*)': ['*'] } : undefined
    });

    if (!uris || uris.length === 0) {
        return null;
    }

    const selected = uris[0].fsPath;
    if (!checkBinaryRunnable(selected)) {
        vscode.window.showErrorMessage(`Thruster: Selected file is not a working arduino-cli executable: "${selected}"`);
        return null;
    }

    await vscode.workspace.getConfiguration('thruster').update('arduinoCliPath', selected, vscode.ConfigurationTarget.Global);
    if (loadConfig()) {
        saveConfig({ arduinoCliPath: selected });
    }

    vscode.window.showInformationMessage(`Thruster: arduino-cli path configured to "${selected}"`);
    if (settingsPanel) {
        settingsPanel.webview.html = getSettingsWebviewHtml(getSystemHealthState());
    }
    return selected;
}

async function ensureArduinoCli(promptIfMissing = true) {
    const existing = resolveArduinoCliPath();
    if (existing) {
        return existing;
    }

    if (!promptIfMissing) {
        return null;
    }

    const choice = await vscode.window.showErrorMessage(
        "Thruster: 'arduino-cli' was not found on your system. It is required to compile, upload, and monitor sketches.",
        { modal: true },
        "⚡ One-Click Auto-Install",
        "📂 Browse / Point to Path...",
        "⚙️ Open Settings & Checklist",
        "Cancel"
    );

    if (choice === "⚡ One-Click Auto-Install") {
        return await installArduinoCliOneClick();
    } else if (choice === "📂 Browse / Point to Path...") {
        return await promptLocateArduinoCli();
    } else if (choice === "⚙️ Open Settings & Checklist") {
        vscode.commands.executeCommand('thruster.openSettings');
        return null;
    }

    return null;
}

function scanSerialPorts(cliPath) {
    return new Promise((resolve) => {
        const ports = [];
        const seen = new Set();

        try {
            const out = cp.execSync(`"${cliPath}" board list --json`, { encoding: 'utf8', timeout: 5000 });
            const parsed = JSON.parse(out);
            if (parsed && parsed.detected_ports) {
                for (const p of parsed.detected_ports) {
                    const addr = p.port && p.port.address;
                    const label = (p.port && (p.port.label || p.port.protocol_label)) || 'Serial Port';
                    if (addr && !seen.has(addr)) {
                        seen.add(addr);
                        ports.push({ address: addr, label: `${addr} (${label})` });
                    }
                }
            }
        } catch (e) {}

        // Fallbacks if CLI returned nothing or failed
        if (ports.length === 0) {
            if (isWin) {
                try {
                    const psOut = cp.execSync(`powershell -NoProfile -Command "[System.IO.Ports.SerialPort]::GetPortNames()"`, { encoding: 'utf8', timeout: 3000 });
                    const lines = psOut.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
                    for (const p of lines) {
                        if (!seen.has(p)) {
                            seen.add(p);
                            ports.push({ address: p, label: `${p} (Serial Port)` });
                        }
                    }
                } catch (err) {}
            } else if (isMac) {
                try {
                    const devFiles = fs.readdirSync('/dev');
                    for (const f of devFiles) {
                        if ((f.startsWith('cu.') || f.startsWith('tty.')) &&
                            !f.toLowerCase().includes('bluetooth') &&
                            !f.toLowerCase().includes('incoming-port') &&
                            !f.toLowerCase().includes('debug-console')) {
                            const full = `/dev/${f}`;
                            if (f.startsWith('cu.') && !seen.has(full)) {
                                seen.add(full);
                                ports.push({ address: full, label: `${full} (Serial Device)` });
                            }
                        }
                    }
                } catch (err) {}
            } else if (isLinux) {
                try {
                    const devFiles = fs.readdirSync('/dev');
                    for (const f of devFiles) {
                        if (f.startsWith('ttyUSB') || f.startsWith('ttyACM')) {
                            const full = `/dev/${f}`;
                            if (!seen.has(full)) {
                                seen.add(full);
                                ports.push({ address: full, label: `${full} (Serial Device)` });
                            }
                        }
                    }
                } catch (err) {}
            }
        }

        resolve(ports);
    });
}

function getOrResolvePort(config, cliPath) {
    const rawPort = config ? config.port : 'auto';
    if (rawPort && rawPort !== 'auto') {
        return Promise.resolve(rawPort);
    }
    return scanSerialPorts(cliPath).then(ports => {
        if (isWin) {
            const usbPorts = ports.filter(p => !p.address.toUpperCase().includes('COM1'));
            if (usbPorts.length > 0) return usbPorts[0].address;
        } else if (isMac) {
            // Prefer USB serial devices (usbserial, usbmodem, wchusb, cp210, slab, uart, ftdi)
            const preferred = ports.filter(p => {
                const lower = p.address.toLowerCase();
                return lower.includes('usbserial') ||
                       lower.includes('usbmodem') ||
                       lower.includes('wchusb') ||
                       lower.includes('cp210') ||
                       lower.includes('slab') ||
                       lower.includes('uart') ||
                       lower.includes('ftdi');
            });
            if (preferred.length > 0) return preferred[0].address;
            const nonBluetooth = ports.filter(p => !p.address.toLowerCase().includes('bluetooth'));
            if (nonBluetooth.length > 0) return nonBluetooth[0].address;
        } else if (isLinux) {
            const preferred = ports.filter(p => p.address.includes('ttyUSB') || p.address.includes('ttyACM'));
            if (preferred.length > 0) return preferred[0].address;
        }

        if (ports.length > 0) {
            return ports[0].address;
        }
        return null;
    });
}

function getActiveSketchDir() {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.fileName.endsWith('.ino')) {
        return path.dirname(editor.document.fileName);
    }
    const root = getWorkspaceRoot();
    if (root) {
        const files = fs.readdirSync(root, { withFileTypes: true });
        for (const f of files) {
            if (f.isDirectory()) {
                const sub = path.join(root, f.name);
                const candidates = fs.readdirSync(sub).filter(fn => fn.endsWith('.ino'));
                if (candidates.length > 0) {
                    return sub;
                }
            } else if (f.name.endsWith('.ino')) {
                return root;
            }
        }
    }
    return null;
}

function getTerminal() {
    if (!terminalInstance || terminalInstance.exitStatus !== undefined) {
        terminalInstance = vscode.window.createTerminal("Thruster");
    }
    return terminalInstance;
}

function ensureCppProperties(root) {
    const propPath = path.join(root, '.vscode', 'c_cpp_properties.json');
    if (fs.existsSync(propPath)) return;

    const home = os.homedir();
    const includePaths = ["${workspaceFolder}/**"];

    if (isWin) {
        const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
        includePaths.push(
            `${localAppData}/Arduino15/packages/**/cores/**`,
            `${localAppData}/Arduino15/packages/**/variants/**`,
            `${localAppData}/Arduino15/packages/**/libraries/**`,
            `${home}/Documents/Arduino/libraries/**`
        );
    } else if (isMac) {
        includePaths.push(
            `${home}/Library/Arduino15/packages/**/cores/**`,
            `${home}/Library/Arduino15/packages/**/variants/**`,
            `${home}/Library/Arduino15/packages/**/libraries/**`,
            `${home}/Documents/Arduino/libraries/**`
        );
    } else {
        includePaths.push(
            `${home}/.arduino15/packages/**/cores/**`,
            `${home}/.arduino15/packages/**/variants/**`,
            `${home}/.arduino15/packages/**/libraries/**`,
            `${home}/Arduino/libraries/**`
        );
    }

    const config = {
        configurations: [
            {
                name: "Thruster Embedded C/C++",
                includePath: includePaths,
                defines: [
                    "ARDUINO=10819",
                    "ESP32",
                    "F_CPU=240000000L"
                ],
                cStandard: "c11",
                cppStandard: "c++17",
                intelliSenseMode: isWin ? "gcc-x64" : (isMac ? "macos-clang-arm64" : "gcc-x64")
            }
        ],
        version: 4
    };

    try {
        fs.writeFileSync(propPath, JSON.stringify(config, null, 2), 'utf8');
    } catch (e) { }
}

async function ensureCoreInstalled(fqbn, cliPath) {
    if (!fqbn || fqbn === 'custom') return true;
    const parts = fqbn.split(':');
    if (parts.length < 2) return true;
    const coreId = `${parts[0]}:${parts[1]}`;

    let installedCores = [];
    try {
        const out = cp.execSync(`"${cliPath}" core list --format json`, { encoding: 'utf8', timeout: 10000 });
        const parsed = JSON.parse(out);
        if (Array.isArray(parsed)) {
            installedCores = parsed.map(c => c.id);
        }
    } catch (e) { }

    if (installedCores.includes(coreId)) {
        return true;
    }

    const additionalUrl = KNOWN_CORE_INDEX_URLS[coreId] || '';
    const urlArgs = additionalUrl ? ` --additional-urls "${additionalUrl}"` : '';

    const term = getTerminal();
    term.show(true);
    sendTerminalEcho(term, `=== Thruster: Core package '${coreId}' is not yet installed ===`, 'yellow');
    sendTerminalEcho(term, `=== Auto-downloading and installing '${coreId}' via arduino-cli... ===`, 'cyan');

    if (additionalUrl) {
        term.sendText(formatCliCmd(cliPath, `core update-index${urlArgs}`));
    }

    if (isWin) {
        term.sendText(`& "${cliPath}" core install ${coreId}${urlArgs}; if ($LASTEXITCODE -eq 0) { Write-Host "=== Core '${coreId}' installed successfully! ===" -ForegroundColor Green }`);
    } else {
        term.sendText(`"${cliPath}" core install ${coreId}${urlArgs} && printf "\\033[1;32m=== Core '${coreId}' installed successfully! ===\\033[0m\\n"`);
    }

    vscode.window.showInformationMessage(`Thruster: Installing the missing '${coreId}' core package in the terminal.`);
    return true;
}

function getAllInstalledBoards(cliPath) {
    return new Promise((resolve) => {
        cp.exec(`"${cliPath}" board listall --format json`, { encoding: 'utf8', maxBuffer: 15 * 1024 * 1024 }, (err, stdout) => {
            if (err || !stdout) return resolve([]);
            try {
                const parsed = JSON.parse(stdout);
                const results = [];
                if (parsed && parsed.boards) {
                    for (const b of parsed.boards) {
                        results.push({
                            label: b.name,
                            fqbn: b.fqbn,
                            description: b.fqbn
                        });
                    }
                }
                resolve(results);
            } catch (e) {
                resolve([]);
            }
        });
    });
}

async function promptSelectBoard(cliPath) {
    const pick = await vscode.window.showQuickPick(POPULAR_BOARDS, {
        placeHolder: "Thruster: Select target board (Default: NodeMCU-32S)",
        ignoreFocusOut: true
    });
    if (!pick) return null;

    let selectedFqbn = pick.fqbn;
    let selectedBoardName = pick.label;

    if (selectedFqbn === 'search_installed') {
        const allBoards = await getAllInstalledBoards(cliPath);
        if (allBoards.length === 0) {
            vscode.window.showWarningMessage("No boards returned from arduino-cli. Please enter FQBN manually.");
            selectedFqbn = 'custom';
        } else {
            const boardPick = await vscode.window.showQuickPick(allBoards, {
                placeHolder: "Type to search any installed board...",
                ignoreFocusOut: true
            });
            if (!boardPick) return null;
            selectedFqbn = boardPick.fqbn;
            selectedBoardName = boardPick.label;
        }
    }

    if (selectedFqbn === 'custom') {
        const customFqbn = await vscode.window.showInputBox({
            prompt: "Enter custom FQBN (e.g. esp32:esp32:nodemcu-32s, arduino:avr:uno, rp2040:rp2040:rpipico)",
            ignoreFocusOut: true
        });
        if (!customFqbn) return null;
        selectedFqbn = customFqbn.trim();
        selectedBoardName = selectedFqbn;
    }

    await ensureCoreInstalled(selectedFqbn, cliPath);

    return { fqbn: selectedFqbn, boardName: selectedBoardName };
}

function getSmartLibraryResolverMode() {
    const config = loadConfig();
    if (config && config.smartLibraryResolver) {
        return config.smartLibraryResolver;
    }
    return vscode.workspace.getConfiguration('thruster').get('smartLibraryResolver', 'auto');
}

function computeFileHash(filePath) {
    try {
        const content = fs.readFileSync(filePath);
        return crypto.createHash('sha1').update(content).digest('hex');
    } catch (e) {
        return null;
    }
}

function getSketchSourceFiles(sketchDir) {
    const sourceExts = ['.ino', '.cpp', '.c', '.h', '.hpp', '.s'];
    const files = [];

    function scanDir(dir) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (!entry.name.startsWith('.') && entry.name !== 'build') {
                        scanDir(fullPath);
                    }
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (sourceExts.includes(ext)) {
                        files.push(fullPath);
                    }
                }
            }
        } catch (e) {}
    }

    scanDir(sketchDir);
    return files;
}

function computeSketchFingerprint(sketchDir) {
    const files = getSketchSourceFiles(sketchDir);
    const hashes = {};
    for (const f of files.sort()) {
        const rel = path.relative(sketchDir, f);
        try {
            const stat = fs.statSync(f);
            const sha1 = computeFileHash(f);
            hashes[rel] = {
                mtimeMs: stat.mtimeMs,
                size: stat.size,
                sha1: sha1
            };
        } catch (e) {}
    }
    return hashes;
}

function getBuildInfoPath(sketchDir) {
    const root = getWorkspaceRoot() || sketchDir;
    return path.join(root, '.vscode', '.thruster_build.json');
}

function isSketchAlreadyCompiled(sketchDir, fqbn) {
    const buildInfoFile = getBuildInfoPath(sketchDir);
    if (!fs.existsSync(buildInfoFile)) {
        return false;
    }

    try {
        const buildInfo = JSON.parse(fs.readFileSync(buildInfoFile, 'utf8'));
        if (!buildInfo || buildInfo.fqbn !== fqbn || buildInfo.sketchDir !== sketchDir) {
            return false;
        }

        const currentFingerprint = computeSketchFingerprint(sketchDir);
        const recordedFingerprint = buildInfo.fingerprint || {};

        const currentKeys = Object.keys(currentFingerprint).sort();
        const recordedKeys = Object.keys(recordedFingerprint).sort();

        if (currentKeys.length !== recordedKeys.length) {
            return false;
        }

        for (let i = 0; i < currentKeys.length; i++) {
            const key = currentKeys[i];
            if (key !== recordedKeys[i]) return false;
            if (currentFingerprint[key].sha1 !== recordedFingerprint[key].sha1) {
                return false;
            }
        }

        return true;
    } catch (e) {
        return false;
    }
}

function recordSuccessfulCompile(sketchDir, fqbn) {
    try {
        const buildInfoFile = getBuildInfoPath(sketchDir);
        const dir = path.dirname(buildInfoFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const fingerprint = computeSketchFingerprint(sketchDir);
        const data = {
            fqbn,
            sketchDir,
            timestamp: Date.now(),
            fingerprint
        };
        fs.writeFileSync(buildInfoFile, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {}
}

function invalidateCompileState(sketchDir) {
    try {
        const buildInfoFile = getBuildInfoPath(sketchDir);
        if (fs.existsSync(buildInfoFile)) {
            fs.unlinkSync(buildInfoFile);
        }
    } catch (e) {}
}

function findMissingHeader(text) {
    if (!text) return null;
    const match = text.match(/(?:fatal error|error):\s*<?([a-zA-Z0-9_\-\.]+)\.h>?:\s*/i);
    if (match && match[1]) {
        const name = match[1];
        if (!BUILTIN_HEADERS.has(name.toLowerCase())) {
            return name;
        }
    }
    return null;
}

function searchLibrary(header, cliPath) {
    return new Promise((resolve) => {
        cp.exec(`"${cliPath}" lib search "${header}" --format json`, { encoding: 'utf8', timeout: 25000 }, (err, stdout) => {
            if (err || !stdout) return resolve(null);
            try {
                const parsed = JSON.parse(stdout);
                if (parsed && parsed.libraries && parsed.libraries.length > 0) {
                    const cleanHeader = header.toLowerCase().replace(/[^a-z0-9]/g, '');
                    for (const lib of parsed.libraries) {
                        const cleanName = lib.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                        if (cleanName.includes(cleanHeader)) {
                            return resolve(lib.name);
                        }
                    }
                    return resolve(parsed.libraries[0].name);
                }
            } catch (e) { }
            resolve(null);
        });
    });
}

function installLibraryAsync(libName, cliPath, term) {
    return new Promise((resolve) => {
        sendTerminalEcho(term, `=== Installing '${libName}' via arduino-cli... ===`, 'magenta');
        cp.exec(`"${cliPath}" lib install "${libName}"`, { encoding: 'utf8', timeout: 90000 }, (err) => {
            if (!err) {
                sendTerminalEcho(term, `=== Successfully installed '${libName}'! ===`, 'green');
                resolve(true);
            } else {
                sendTerminalEcho(term, `=== Failed to install '${libName}': ${err.message} ===`, 'red');
                resolve(false);
            }
        });
    });
}

async function compileWithSmartResolver(sketchDir, fqbn, cliPath, term) {
    const resolverMode = getSmartLibraryResolverMode();
    const maxRetries = (resolverMode === 'off') ? 1 : 6;
    let attempt = 0;
    const installedInThisRun = new Set();

    term.show(true);

    while (attempt < maxRetries) {
        attempt++;
        sendTerminalEcho(term, `=== Thruster: Compiling Sketch... ===`, 'cyan');

        const result = await new Promise((resolve) => {
            cp.exec(`"${cliPath}" compile --fqbn ${fqbn} "${sketchDir}"`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
                resolve({
                    success: !err,
                    output: (stdout || '') + '\n' + (stderr || '')
                });
            });
        });

        if (result.success) {
            sendTerminalEcho(term, `=== Thruster: Compilation Successful! ===`, 'green');
            return true;
        }

        const missingHeader = findMissingHeader(result.output);

        if (!missingHeader || resolverMode === 'off') {
            term.sendText(formatCliCmd(cliPath, `compile --fqbn ${fqbn} "${sketchDir}"`));
            return false;
        }

        if (installedInThisRun.has(missingHeader.toLowerCase())) {
            term.sendText(formatCliCmd(cliPath, `compile --fqbn ${fqbn} "${sketchDir}"`));
            return false;
        }

        sendTerminalEcho(term, `=== Thruster Smart Resolver: Detected missing header <${missingHeader}.h> ===`, 'yellow');

        const foundLib = await searchLibrary(missingHeader, cliPath);
        if (!foundLib) {
            sendTerminalEcho(term, `=== Thruster: No matching library found in registry for <${missingHeader}.h> ===`, 'red');
            term.sendText(formatCliCmd(cliPath, `compile --fqbn ${fqbn} "${sketchDir}"`));
            return false;
        }

        if (resolverMode === 'with warning') {
            const userPick = await vscode.window.showWarningMessage(
                `Thruster: Missing header <${missingHeader}.h>. Found library "${foundLib}". Install now?`,
                "Install & Recompile", "Cancel"
            );
            if (userPick !== "Install & Recompile") {
                term.sendText(formatCliCmd(cliPath, `compile --fqbn ${fqbn} "${sketchDir}"`));
                return false;
            }
        }

        vscode.window.showInformationMessage(`[Thruster] Auto-installing missing library: "${foundLib}"...`);
        installedInThisRun.add(missingHeader.toLowerCase());

        const success = await installLibraryAsync(foundLib, cliPath, term);
        if (!success) {
            term.sendText(formatCliCmd(cliPath, `compile --fqbn ${fqbn} "${sketchDir}"`));
            return false;
        }
        sendTerminalEcho(term, `=== Installed '${foundLib}'! Recompiling... ===`, 'cyan');
    }

    return false;
}

async function scanAndInstallSketchLibraries(sketchDir, cliPath, term) {
    term.show(true);
    sendTerminalEcho(term, `=== Thruster: Scanning Sketch for External Libraries... ===`, 'cyan');

    let files = [];
    try {
        files = fs.readdirSync(sketchDir).filter(f => f.endsWith('.ino') || f.endsWith('.cpp') || f.endsWith('.h'));
    } catch (e) {
        vscode.window.showErrorMessage("Failed to read sketch directory.");
        return;
    }

    const headers = new Set();
    for (const f of files) {
        try {
            const content = fs.readFileSync(path.join(sketchDir, f), 'utf8');
            const lines = content.split(/\r?\n/);
            for (const l of lines) {
                const match = l.match(/^\s*#\s*include\s*<([a-zA-Z0-9_\-\.]+)\.h>/);
                if (match && match[1]) {
                    const h = match[1];
                    if (!BUILTIN_HEADERS.has(h.toLowerCase())) {
                        headers.add(h);
                    }
                }
            }
        } catch (e) { }
    }

    if (headers.size === 0) {
        vscode.window.showInformationMessage("Thruster: No external library headers (<...>) detected in sketch.");
        return;
    }

    sendTerminalEcho(term, `=== Found ${headers.size} candidate external library headers: ${Array.from(headers).join(', ')} ===`, 'yellow');
    for (const h of headers) {
        const found = await searchLibrary(h, cliPath);
        if (found) {
            await installLibraryAsync(found, cliPath, term);
        } else {
            sendTerminalEcho(term, `=== Could not find registry library for <${h}.h> ===`, 'yellow');
        }
    }
    vscode.window.showInformationMessage("Thruster: Library scan and install complete!");
}

let isBusy = false;

function setBusy(busy) {
    isBusy = busy;
    vscode.commands.executeCommand('setContext', 'thruster.isBusy', busy);
    updateState();
}

async function stopSerialMonitor(verbose = false) {
    if (!isMonitoring && !terminalInstance) return;

    if (terminalInstance) {
        try {
            terminalInstance.sendText('\u0003', false);
            await new Promise(r => setTimeout(r, 350));
            terminalInstance.sendText('\u0003', false);
            await new Promise(r => setTimeout(r, 200));
            if (verbose) {
                sendTerminalEcho(terminalInstance, `=== Thruster: Serial Monitor Stopped ===`, 'yellow');
            }
        } catch (e) { }
    }
    isMonitoring = false;
    updateState();
}

function waitForLockRelease(lockPath, maxTimeoutMs = 180000) {
    return new Promise((resolve) => {
        const start = Date.now();
        const interval = setInterval(() => {
            if (!fs.existsSync(lockPath) || (Date.now() - start > maxTimeoutMs)) {
                clearInterval(interval);
                resolve();
            }
        }, 200);
    });
}

function updateState() {
    const config = loadConfig();
    const isInit = !!(config && config.board);
    vscode.commands.executeCommand('setContext', 'thruster.isInitialized', isInit);
    vscode.commands.executeCommand('setContext', 'thruster.isBusy', isBusy);
    vscode.commands.executeCommand('setContext', 'thruster.isMonitoring', isMonitoring);

    if (isInit) {
        if (initStatusBarItem) initStatusBarItem.hide();
        if (boardStatusBarItem) {
            if (isBusy) {
                boardStatusBarItem.text = `$(sync~spin) Thruster: Working...`;
            } else {
                boardStatusBarItem.text = `$(circuit-board) ${config.boardName || config.board}`;
            }
            boardStatusBarItem.show();
        }
        if (portStatusBarItem) {
            if (isMonitoring) {
                portStatusBarItem.text = `$(radio-tower) ${config.port || 'auto'} (Monitoring)`;
                portStatusBarItem.tooltip = `Thruster: Serial Monitor active on ${config.port || 'auto'}. Click to select Serial port (will exit monitor).`;
            } else {
                portStatusBarItem.text = `$(plug) ${config.port || 'auto'}`;
                portStatusBarItem.tooltip = 'Thruster: Click to select Serial port';
            }
            portStatusBarItem.show();
        }
    } else {
        if (boardStatusBarItem) boardStatusBarItem.hide();
        if (portStatusBarItem) portStatusBarItem.hide();
        if (initStatusBarItem) {
            initStatusBarItem.text = isBusy ? `$(sync~spin) Thruster: Busy...` : `$(rocket) Thruster: Init`;
            initStatusBarItem.show();
        }
    }
}

function getSystemHealthState() {
    const cliPath = resolveArduinoCliPath();
    const isCliValid = !!(cliPath && checkBinaryRunnable(cliPath));
    const cliVersion = isCliValid ? getBinaryVersion(cliPath) : '';

    const config = loadConfig() || {};
    const vsConfig = vscode.workspace.getConfiguration('thruster');
    const configuredPath = vsConfig.get('arduinoCliPath') || (config && config.arduinoCliPath) || '';
    const resolverMode = getSmartLibraryResolverMode();
    const baudRate = (config && config.baudRate) || vsConfig.get('defaultBaudRate', 115200);
    const board = (config && config.board) || 'esp32:esp32:nodemcu-32s';
    const boardName = (config && config.boardName) || 'NodeMCU-32S (ESP32)';
    const port = (config && config.port) || 'auto';

    return {
        cli: {
            isValid: isCliValid,
            path: cliPath || '',
            version: cliVersion,
            configuredPath: configuredPath
        },
        settings: {
            resolverMode,
            baudRate,
            board,
            boardName,
            port
        },
        system: {
            platform: process.platform,
            arch: process.arch,
            isWindows: isWin,
            isMac: isMac,
            isLinux: isLinux
        }
    };
}

function getSettingsWebviewHtml(state) {
    const cliOk = state.cli.isValid;
    const cliPathText = state.cli.path || (state.cli.configuredPath ? `${state.cli.configuredPath} (Not Found)` : 'None detected');
    const cliVerText = state.cli.version || 'Unknown / Not detected';

    const osLabel = state.system.isMac
        ? `macOS (${state.system.arch})`
        : (state.system.isWindows ? `Windows (${state.system.arch})` : `Linux (${state.system.arch})`);

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Thruster Control Center</title>
    <style>
        :root {
            --bg-color: var(--vscode-editor-background);
            --fg-color: var(--vscode-editor-foreground);
            --card-bg: var(--vscode-sideBar-background, rgba(255, 255, 255, 0.04));
            --card-border: var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
            --btn-bg: var(--vscode-button-background);
            --btn-fg: var(--vscode-button-foreground);
            --btn-hover: var(--vscode-button-hoverBackground);
            --input-bg: var(--vscode-input-background);
            --input-fg: var(--vscode-input-foreground);
            --input-border: var(--vscode-input-border, rgba(255, 255, 255, 0.15));
            --accent-green: #388e3c;
            --accent-green-bg: rgba(56, 142, 60, 0.15);
            --accent-red: #d32f2f;
            --accent-red-bg: rgba(211, 47, 47, 0.15);
            --accent-cyan: #0288d1;
        }

        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
            font-size: var(--vscode-font-size, 13px);
            color: var(--fg-color);
            background-color: var(--bg-color);
            margin: 0;
            padding: 24px;
            line-height: 1.5;
        }

        .container {
            max-width: 860px;
            margin: 0 auto;
        }

        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid var(--card-border);
            padding-bottom: 18px;
            margin-bottom: 24px;
        }

        .header-title-box {
            display: flex;
            align-items: center;
            gap: 14px;
        }

        .header-icon {
            font-size: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 48px;
            height: 48px;
            border-radius: 12px;
            background: linear-gradient(135deg, rgba(2, 136, 209, 0.2), rgba(0, 230, 118, 0.2));
            border: 1px solid var(--card-border);
        }

        .header-title {
            font-size: 22px;
            font-weight: 700;
            margin: 0;
            letter-spacing: -0.5px;
        }

        .header-subtitle {
            margin: 2px 0 0 0;
            opacity: 0.75;
            font-size: 13px;
        }

        .badges {
            display: flex;
            gap: 8px;
            align-items: center;
        }

        .badge {
            display: inline-block;
            padding: 3px 10px;
            border-radius: 999px;
            font-size: 11px;
            font-weight: 600;
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .card {
            background-color: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 10px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
        }

        .card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 14px;
        }

        .card-title {
            font-size: 15px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 0;
        }

        .status-pill {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 12px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 600;
        }

        .status-pill.pass {
            color: #4caf50;
            background-color: var(--accent-green-bg);
            border: 1px solid rgba(76, 175, 80, 0.4);
        }

        .status-pill.fail {
            color: #ef5350;
            background-color: var(--accent-red-bg);
            border: 1px solid rgba(239, 83, 80, 0.4);
        }

        .checklist-item {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 16px;
            padding: 16px;
            background: rgba(0, 0, 0, 0.15);
            border-radius: 8px;
            border: 1px solid var(--card-border);
            margin-top: 10px;
        }

        .checklist-info {
            flex: 1;
        }

        .checklist-name {
            font-size: 14px;
            font-weight: 600;
            margin: 0 0 4px 0;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .checklist-desc {
            font-size: 12.5px;
            opacity: 0.8;
            margin: 0 0 10px 0;
        }

        .checklist-meta {
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 12px;
            background: rgba(0, 0, 0, 0.25);
            padding: 6px 10px;
            border-radius: 4px;
            word-break: break-all;
            margin-top: 6px;
            border: 1px solid rgba(255, 255, 255, 0.05);
        }

        .actions-row {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            margin-top: 10px;
        }

        button {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 7px 14px;
            border: none;
            border-radius: 6px;
            background-color: var(--btn-bg);
            color: var(--btn-fg);
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s ease;
        }

        button:hover {
            background-color: var(--btn-hover);
        }

        button.secondary {
            background-color: transparent;
            color: var(--fg-color);
            border: 1px solid var(--card-border);
        }

        button.secondary:hover {
            background-color: rgba(255, 255, 255, 0.08);
        }

        .grid-2 {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
        }

        .form-group {
            margin-bottom: 14px;
        }

        label {
            display: block;
            font-size: 12px;
            font-weight: 600;
            margin-bottom: 6px;
            opacity: 0.9;
        }

        input[type="text"], select {
            width: 100%;
            box-sizing: border-box;
            padding: 8px 10px;
            background-color: var(--input-bg);
            color: var(--input-fg);
            border: 1px solid var(--input-border);
            border-radius: 6px;
            font-size: 13px;
            outline: none;
        }

        input[type="text"]:focus, select:focus {
            border-color: var(--accent-cyan);
        }

        .footer-links {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-top: 24px;
            padding-top: 16px;
            border-top: 1px solid var(--card-border);
            font-size: 12px;
            opacity: 0.75;
        }

        .link-btn {
            color: var(--accent-cyan);
            text-decoration: none;
            cursor: pointer;
            font-weight: 500;
        }

        .link-btn:hover {
            text-decoration: underline;
        }

        .system-banner {
            padding: 12px 16px;
            border-radius: 8px;
            font-size: 13px;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .system-banner.pass {
            background-color: var(--accent-green-bg);
            border: 1px solid rgba(76, 175, 80, 0.4);
            color: #81c784;
        }

        .system-banner.fail {
            background-color: var(--accent-red-bg);
            border: 1px solid rgba(239, 83, 80, 0.4);
            color: #e57373;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="header-title-box">
                <div class="header-icon">🚀</div>
                <div>
                    <h1 class="header-title">Thruster Settings & Checklist</h1>
                    <p class="header-subtitle">One-click compile, flash, and serial monitor for ESP32, Arduino, RP2040, and STM32</p>
                </div>
            </div>
            <div class="badges">
                <span class="badge">v0.2.0</span>
                <span class="badge">${osLabel}</span>
            </div>
        </div>

        ${cliOk ? `
        <div class="system-banner pass">
            <span>🟢</span>
            <div><strong>Ready to Go:</strong> All essential prerequisites are met. You can compile, flash, and monitor sketches with one click.</div>
        </div>
        ` : `
        <div class="system-banner fail">
            <span>🔴</span>
            <div><strong>Action Required:</strong> arduino-cli is missing. Complete Step 1 below to enable compilation and firmware uploads.</div>
        </div>
        `}

        <!-- 1. Environment Readiness Checklist -->
        <div class="card">
            <div class="card-header">
                <h2 class="card-title">📋 Extension Readiness Checklist</h2>
                <button class="secondary" id="btn-recheck">🔄 Re-check All</button>
            </div>
            <div style="font-size: 12.5px; opacity: 0.8; margin-bottom: 12px;">
                Thruster performs automated checks on your PC to ensure microcontroller tools are installed and ready.
            </div>

            <!-- Step 1: arduino-cli check -->
            <div class="checklist-item">
                <div class="checklist-info">
                    <div class="checklist-name">
                        <span>1. Valid arduino-cli Executable</span>
                        ${cliOk ? `
                            <span class="status-pill pass">✔ READY</span>
                        ` : `
                            <span class="status-pill fail">✖ NOT FOUND</span>
                        `}
                    </div>
                    <div class="checklist-desc">
                        ${cliOk ? 'arduino-cli is installed and fully operational on this system.' : 'Required backend for sketch compilation, firmware flashing, and serial monitoring.'}
                    </div>
                    <div class="checklist-meta">
                        <strong>Status:</strong> ${cliOk ? 'Operational' : 'Missing'}<br>
                        <strong>Resolved Path:</strong> ${cliPathText}<br>
                        <strong>Version:</strong> ${cliVerText}
                    </div>

                    <div class="actions-row">
                        ${cliOk ? `
                            <button class="secondary" id="btn-recheck-cli">🔄 Test / Re-check</button>
                            <button class="secondary" id="btn-browse-cli">📂 Change Path...</button>
                            <button class="secondary" id="btn-install-cli">⚡ Re-install Binary</button>
                        ` : `
                            <button id="btn-install-cli">⚡ One-Click Auto-Install</button>
                            <button class="secondary" id="btn-browse-cli">📂 Browse / Select Path...</button>
                            <button class="secondary" id="btn-detect-cli">🔍 Auto-Detect on System</button>
                        `}
                    </div>
                </div>
            </div>
        </div>

        <!-- 2. Settings & Options -->
        <div class="card">
            <div class="card-header">
                <h2 class="card-title">⚙️ General Settings</h2>
            </div>

            <div class="form-group">
                <label for="cli-path-input">Custom arduino-cli Binary Path (Leave blank to use auto-detection):</label>
                <div style="display: flex; gap: 8px;">
                    <input type="text" id="cli-path-input" value="${state.cli.configuredPath || ''}" placeholder="e.g. /opt/homebrew/bin/arduino-cli or C:\\...\\arduino-cli.exe" />
                    <button id="btn-save-path">Save</button>
                </div>
            </div>

            <div class="grid-2">
                <div class="form-group">
                    <label for="resolver-select">Smart Library Auto-Resolver:</label>
                    <select id="resolver-select">
                        <option value="auto" ${state.settings.resolverMode === 'auto' ? 'selected' : ''}>Auto (Detect missing header & install automatically)</option>
                        <option value="with warning" ${state.settings.resolverMode === 'with warning' ? 'selected' : ''}>With Warning (Prompt before installing)</option>
                        <option value="off" ${state.settings.resolverMode === 'off' ? 'selected' : ''}>Off (Disabled)</option>
                    </select>
                </div>

                <div class="form-group">
                    <label for="baud-select">Default Serial Monitor Baud Rate:</label>
                    <select id="baud-select">
                        <option value="115200" ${state.settings.baudRate === 115200 ? 'selected' : ''}>115200 (Default for ESP32 / RP2040)</option>
                        <option value="9600" ${state.settings.baudRate === 9600 ? 'selected' : ''}>9600 (Classic Arduino Uno / Nano)</option>
                        <option value="57600" ${state.settings.baudRate === 57600 ? 'selected' : ''}>57600</option>
                        <option value="921600" ${state.settings.baudRate === 921600 ? 'selected' : ''}>921600 (High-Speed Upload)</option>
                    </select>
                </div>
            </div>
        </div>

        <!-- 3. Current Workspace Hardware -->
        <div class="card">
            <div class="card-header">
                <h2 class="card-title">🔌 Current Project Hardware Target</h2>
            </div>
            <div class="grid-2">
                <div style="padding: 12px; background: rgba(0,0,0,0.15); border-radius: 6px; border: 1px solid var(--card-border);">
                    <div style="font-size: 11px; opacity: 0.7; text-transform: uppercase; font-weight: 600;">Target Board</div>
                    <div style="font-size: 14px; font-weight: 600; margin: 4px 0;">${state.settings.boardName}</div>
                    <div style="font-size: 11.5px; opacity: 0.75; font-family: monospace;">${state.settings.board}</div>
                    <div style="margin-top: 10px;">
                        <button class="secondary" id="btn-select-board">🎯 Switch Board...</button>
                    </div>
                </div>

                <div style="padding: 12px; background: rgba(0,0,0,0.15); border-radius: 6px; border: 1px solid var(--card-border);">
                    <div style="font-size: 11px; opacity: 0.7; text-transform: uppercase; font-weight: 600;">Serial Port</div>
                    <div style="font-size: 14px; font-weight: 600; margin: 4px 0;">${state.settings.port === 'auto' ? 'Auto-Detect Port' : state.settings.port}</div>
                    <div style="font-size: 11.5px; opacity: 0.75;">${state.settings.port === 'auto' ? 'Automatically resolves connected USB device' : 'Manually specified device'}</div>
                    <div style="margin-top: 10px;">
                        <button class="secondary" id="btn-select-port">🔌 Change Port / Scan...</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 4. Community & Support -->
        <div class="card">
            <div class="card-header">
                <h2 class="card-title">💬 Community & Issue Reporting</h2>
            </div>
            <div style="font-size: 12.5px; opacity: 0.85; margin-bottom: 14px;">
                Thruster is open-source. Have a question, want to report a bug, or request support for a new microcontroller? Let us know on GitHub!
            </div>
            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                <button class="secondary" id="btn-github">🐙 GitHub Repository</button>
                <button class="secondary" id="btn-issues">🐛 Report an Issue / Feedback</button>
            </div>
        </div>

        <div class="footer-links">
            <div>Thruster • Developed by the-biKing</div>
            <div>
                <a class="link-btn" id="link-github-repo">https://github.com/the-biKing/Thruster.git</a>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        document.getElementById('btn-recheck')?.addEventListener('click', () => {
            vscode.postMessage({ command: 'recheck' });
        });

        document.getElementById('btn-recheck-cli')?.addEventListener('click', () => {
            vscode.postMessage({ command: 'recheck' });
        });

        document.getElementById('btn-install-cli')?.addEventListener('click', () => {
            vscode.postMessage({ command: 'installCli' });
        });

        document.getElementById('btn-browse-cli')?.addEventListener('click', () => {
            vscode.postMessage({ command: 'browseCli' });
        });

        document.getElementById('btn-detect-cli')?.addEventListener('click', () => {
            vscode.postMessage({ command: 'detectCli' });
        });

        document.getElementById('btn-save-path')?.addEventListener('click', () => {
            const val = document.getElementById('cli-path-input').value;
            vscode.postMessage({ command: 'setCliPath', value: val });
        });

        document.getElementById('resolver-select')?.addEventListener('change', (e) => {
            vscode.postMessage({ command: 'setResolver', value: e.target.value });
        });

        document.getElementById('baud-select')?.addEventListener('change', (e) => {
            vscode.postMessage({ command: 'setBaud', value: e.target.value });
        });

        document.getElementById('btn-select-board')?.addEventListener('click', () => {
            vscode.postMessage({ command: 'selectBoard' });
        });

        document.getElementById('btn-select-port')?.addEventListener('click', () => {
            vscode.postMessage({ command: 'selectPort' });
        });

        document.getElementById('btn-github')?.addEventListener('click', () => {
            vscode.postMessage({ command: 'openUrl', url: 'https://github.com/the-biKing/Thruster.git' });
        });

        document.getElementById('btn-issues')?.addEventListener('click', () => {
            vscode.postMessage({ command: 'openUrl', url: 'https://github.com/the-biKing/Thruster/issues' });
        });

        document.getElementById('link-github-repo')?.addEventListener('click', () => {
            vscode.postMessage({ command: 'openUrl', url: 'https://github.com/the-biKing/Thruster.git' });
        });
    </script>
</body>
</html>`;
}

function openSettingsPanel(context) {
    if (settingsPanel) {
        settingsPanel.reveal(vscode.ViewColumn.One);
        settingsPanel.webview.html = getSettingsWebviewHtml(getSystemHealthState());
        return;
    }

    settingsPanel = vscode.window.createWebviewPanel(
        'thrusterSettings',
        'Thruster: Settings & Checklist',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    settingsPanel.onDidDispose(() => {
        settingsPanel = null;
    }, null, context.subscriptions);

    settingsPanel.webview.html = getSettingsWebviewHtml(getSystemHealthState());

    settingsPanel.webview.onDidReceiveMessage(async (msg) => {
        switch (msg.command) {
            case 'recheck': {
                if (settingsPanel) {
                    settingsPanel.webview.html = getSettingsWebviewHtml(getSystemHealthState());
                }
                vscode.window.showInformationMessage("Thruster: System readiness checklist refreshed.");
                break;
            }
            case 'installCli': {
                await installArduinoCliOneClick();
                if (settingsPanel) {
                    settingsPanel.webview.html = getSettingsWebviewHtml(getSystemHealthState());
                }
                break;
            }
            case 'browseCli': {
                const picked = await promptLocateArduinoCli();
                if (picked && settingsPanel) {
                    settingsPanel.webview.html = getSettingsWebviewHtml(getSystemHealthState());
                }
                break;
            }
            case 'detectCli': {
                const found = resolveArduinoCliPath();
                if (found) {
                    await vscode.workspace.getConfiguration('thruster').update('arduinoCliPath', found, vscode.ConfigurationTarget.Global);
                    if (loadConfig()) saveConfig({ arduinoCliPath: found });
                    vscode.window.showInformationMessage(`Thruster: Detected arduino-cli at ${found}`);
                } else {
                    vscode.window.showWarningMessage("Thruster: arduino-cli was not found in standard directories.");
                }
                if (settingsPanel) {
                    settingsPanel.webview.html = getSettingsWebviewHtml(getSystemHealthState());
                }
                break;
            }
            case 'setCliPath': {
                const p = (msg.value || '').trim();
                await vscode.workspace.getConfiguration('thruster').update('arduinoCliPath', p, vscode.ConfigurationTarget.Global);
                if (loadConfig()) saveConfig({ arduinoCliPath: p });
                vscode.window.showInformationMessage(`Thruster: arduinoCliPath updated.`);
                if (settingsPanel) {
                    settingsPanel.webview.html = getSettingsWebviewHtml(getSystemHealthState());
                }
                break;
            }
            case 'setResolver': {
                const val = msg.value || 'auto';
                await vscode.workspace.getConfiguration('thruster').update('smartLibraryResolver', val, vscode.ConfigurationTarget.Global);
                if (loadConfig()) {
                    saveConfig({ smartLibraryResolver: val });
                }
                vscode.window.showInformationMessage(`Thruster: Smart Library Auto-Resolver set to "${val}".`);
                if (settingsPanel) {
                    settingsPanel.webview.html = getSettingsWebviewHtml(getSystemHealthState());
                }
                break;
            }
            case 'setBaud': {
                const baud = parseInt(msg.value, 10) || 115200;
                await vscode.workspace.getConfiguration('thruster').update('defaultBaudRate', baud, vscode.ConfigurationTarget.Global);
                if (loadConfig()) saveConfig({ baudRate: baud });
                vscode.window.showInformationMessage(`Thruster: Default baud rate set to ${baud}.`);
                if (settingsPanel) {
                    settingsPanel.webview.html = getSettingsWebviewHtml(getSystemHealthState());
                }
                break;
            }
            case 'selectBoard': {
                if (isMonitoring) await stopSerialMonitor();
                const cli = await ensureArduinoCli(false);
                if (!cli) {
                    vscode.window.showErrorMessage("Please install or locate arduino-cli first.");
                    return;
                }
                const boardInfo = await promptSelectBoard(cli);
                if (boardInfo) {
                    saveConfig({ board: boardInfo.fqbn, boardName: boardInfo.boardName });
                    updateState();
                    if (settingsPanel) {
                        settingsPanel.webview.html = getSettingsWebviewHtml(getSystemHealthState());
                    }
                }
                break;
            }
            case 'selectPort': {
                const cli = await ensureArduinoCli(false);
                if (!cli) {
                    vscode.window.showErrorMessage("Please install or locate arduino-cli first.");
                    return;
                }
                await vscode.commands.executeCommand('thruster.selectPort');
                if (settingsPanel) {
                    settingsPanel.webview.html = getSettingsWebviewHtml(getSystemHealthState());
                }
                break;
            }
            case 'openUrl': {
                if (msg.url) {
                    vscode.env.openExternal(vscode.Uri.parse(msg.url));
                }
                break;
            }
        }
    }, null, context.subscriptions);
}

function activate(context) {
    // 1. Setup Status Bar
    initStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    initStatusBarItem.command = 'thruster.init';
    initStatusBarItem.tooltip = 'Thruster: Initialize project settings';
    context.subscriptions.push(initStatusBarItem);

    boardStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    boardStatusBarItem.command = 'thruster.selectBoard';
    boardStatusBarItem.tooltip = 'Thruster: Click to switch target board';
    context.subscriptions.push(boardStatusBarItem);

    portStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    portStatusBarItem.command = 'thruster.selectPort';
    portStatusBarItem.tooltip = 'Thruster: Click to select Serial port';
    context.subscriptions.push(portStatusBarItem);

    // Watch config file changes
    const watcher = vscode.workspace.createFileSystemWatcher('**/.vscode/arduino.json');
    watcher.onDidCreate(() => updateState());
    watcher.onDidChange(() => updateState());
    watcher.onDidDelete(() => updateState());
    context.subscriptions.push(watcher);

    // Watch terminal closure to reset monitor state
    vscode.window.onDidCloseTerminal((t) => {
        if (t === terminalInstance) {
            terminalInstance = null;
            isMonitoring = false;
            updateState();
        }
    }, null, context.subscriptions);

    updateState();

    // 2. Register Commands
    context.subscriptions.push(vscode.commands.registerCommand('thruster.openSettings', () => {
        openSettingsPanel(context);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('thruster.init', async () => {
        if (isBusy) {
            vscode.window.showWarningMessage("Thruster: A compile or flash task is already in progress.");
            return;
        }

        if (isMonitoring) {
            await stopSerialMonitor();
        }

        const root = getWorkspaceRoot();
        if (!root) {
            vscode.window.showErrorMessage("Please open a workspace folder first.");
            return;
        }

        const cliPath = await ensureArduinoCli();
        if (!cliPath) return;

        // Step 1: Select Board (with core auto-installation)
        const boardInfo = await promptSelectBoard(cliPath);
        if (!boardInfo) return;

        // Step 2: Select Port
        const detectedPorts = await scanSerialPorts(cliPath);
        const portChoices = [
            { label: "Auto-detect USB Port (Recommended)", port: "auto", description: "Automatically finds the connected USB port on each flash" }
        ];
        detectedPorts.forEach(p => {
            portChoices.push({ label: p.label, port: p.address, description: "Fixed serial port" });
        });
        portChoices.push({
            label: "Enter serial port manually...",
            port: "manual",
            description: isWin ? "e.g. COM3" : "e.g. /dev/cu.usbserial-0001"
        });

        const portPick = await vscode.window.showQuickPick(portChoices, {
            placeHolder: "Thruster: Select upload serial port",
            ignoreFocusOut: true
        });
        if (!portPick) return;

        let selectedPort = portPick.port;
        if (selectedPort === 'manual') {
            const manualPort = await vscode.window.showInputBox({
                prompt: isWin ? "Enter COM port (e.g. COM3)" : "Enter Serial port (e.g. /dev/cu.usbserial-0001)",
                ignoreFocusOut: true
            });
            if (!manualPort) return;
            selectedPort = manualPort.trim();
        }

        // Step 3: Baud Rate
        const baudChoices = ["115200", "9600", "57600", "921600"];
        const baudPick = await vscode.window.showQuickPick(baudChoices, {
            placeHolder: "Thruster: Select Serial Monitor Baud Rate (Default: 115200)",
            ignoreFocusOut: true
        });
        const selectedBaud = parseInt(baudPick || "115200", 10);

        saveConfig({
            board: boardInfo.fqbn,
            boardName: boardInfo.boardName,
            port: selectedPort,
            baudRate: selectedBaud,
            arduinoCliPath: cliPath
        });

        ensureCppProperties(root);
        updateState();

        vscode.window.showInformationMessage(`Thruster initialized for ${boardInfo.boardName}! Toolbar buttons are now ready.`);
    }));

    // Compile Command (with Smart Library Resolver & Busy Lock)
    context.subscriptions.push(vscode.commands.registerCommand('thruster.compile', async () => {
        if (isBusy) {
            vscode.window.showWarningMessage("Thruster: A compile or flash task is already in progress.");
            return;
        }

        if (isMonitoring) {
            await stopSerialMonitor();
        }

        await vscode.workspace.saveAll(false);

        const cliPath = await ensureArduinoCli();
        if (!cliPath) return;

        const sketchDir = getActiveSketchDir();
        if (!sketchDir) {
            vscode.window.showErrorMessage("No .ino sketch found to compile. Please open an .ino file.");
            return;
        }

        const config = loadConfig();
        const fqbn = (config && config.board) || "esp32:esp32:nodemcu-32s";
        const term = getTerminal();

        try {
            setBusy(true);
            const ok = await compileWithSmartResolver(sketchDir, fqbn, cliPath, term);
            if (ok) {
                recordSuccessfulCompile(sketchDir, fqbn);
                vscode.window.showInformationMessage("Thruster: Compilation verified successfully!");
            } else {
                invalidateCompileState(sketchDir);
            }
        } finally {
            setBusy(false);
        }
    }));

    // Flash Command (with Smart Compile Skipping & Busy Lock)
    context.subscriptions.push(vscode.commands.registerCommand('thruster.flash', async () => {
        if (isBusy) {
            vscode.window.showWarningMessage("Thruster: A compile or flash task is already in progress.");
            return;
        }

        if (isMonitoring) {
            await stopSerialMonitor();
        }

        await vscode.workspace.saveAll(false);

        const cliPath = await ensureArduinoCli();
        if (!cliPath) return;

        const sketchDir = getActiveSketchDir();
        if (!sketchDir) {
            vscode.window.showErrorMessage("No .ino sketch found to flash. Please open an .ino file.");
            return;
        }

        const config = loadConfig();
        const fqbn = (config && config.board) || "esp32:esp32:nodemcu-32s";

        const port = await getOrResolvePort(config, cliPath);
        if (!port) {
            vscode.window.showErrorMessage("No USB serial port detected. Please plug in your board or set port via status bar.");
            return;
        }

        const term = getTerminal();
        term.show(true);

        const isUpToDate = isSketchAlreadyCompiled(sketchDir, fqbn);
        const lockFile = path.join(os.tmpdir(), `thruster_flash_${Date.now()}.lock`);

        try {
            setBusy(true);
            if (isUpToDate) {
                sendTerminalEcho(term, `=== Thruster: Code unchanged since last compilation for ${fqbn} ===`, 'green');
                sendTerminalEcho(term, `=== Skipping compile stage and uploading directly to ${port}... ===`, 'cyan');
            } else {
                const ok = await compileWithSmartResolver(sketchDir, fqbn, cliPath, term);
                if (!ok) {
                    invalidateCompileState(sketchDir);
                    return;
                }
                recordSuccessfulCompile(sketchDir, fqbn);
            }

            fs.writeFileSync(lockFile, 'busy', 'utf8');
            sendTerminalEcho(term, `=== Thruster: Flashing (Uploading) to ${port}... ===`, 'cyan');
            let uploadCmd;
            if (isWin) {
                uploadCmd = `try { & "${cliPath}" upload -p "${port}" --fqbn ${fqbn} "${sketchDir}" } finally { Remove-Item -Path "${lockFile}" -Force -ErrorAction SilentlyContinue }`;
            } else {
                uploadCmd = `"${cliPath}" upload -p "${port}" --fqbn ${fqbn} "${sketchDir}"; rm -f "${lockFile}"`;
            }
            term.sendText(uploadCmd);
            await waitForLockRelease(lockFile);
        } finally {
            try { if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile); } catch (e) { }
            setBusy(false);
        }
    }));

    // Flash & Monitor Command (with Smart Compile Skipping & Busy Lock)
    context.subscriptions.push(vscode.commands.registerCommand('thruster.flashAndMonitor', async () => {
        if (isBusy) {
            vscode.window.showWarningMessage("Thruster: A compile or flash task is already in progress.");
            return;
        }

        if (isMonitoring) {
            await stopSerialMonitor();
        }

        await vscode.workspace.saveAll(false);

        const cliPath = await ensureArduinoCli();
        if (!cliPath) return;

        const sketchDir = getActiveSketchDir();
        if (!sketchDir) {
            vscode.window.showErrorMessage("No .ino sketch found to flash. Please open an .ino file.");
            return;
        }

        const config = loadConfig();
        const fqbn = (config && config.board) || "esp32:esp32:nodemcu-32s";
        const baud = (config && config.baudRate) || 115200;

        const port = await getOrResolvePort(config, cliPath);
        if (!port) {
            vscode.window.showErrorMessage("No USB serial port detected. Please plug in your board or set port via status bar.");
            return;
        }

        const term = getTerminal();
        term.show(true);

        const isUpToDate = isSketchAlreadyCompiled(sketchDir, fqbn);
        const lockFile = path.join(os.tmpdir(), `thruster_flash_${Date.now()}.lock`);
        const statusFile = path.join(os.tmpdir(), `thruster_status_${Date.now()}.txt`);

        try {
            setBusy(true);
            if (isUpToDate) {
                sendTerminalEcho(term, `=== Thruster: Code unchanged since last compilation for ${fqbn} ===`, 'green');
                sendTerminalEcho(term, `=== Skipping compile stage and uploading directly to ${port}... ===`, 'cyan');
            } else {
                const ok = await compileWithSmartResolver(sketchDir, fqbn, cliPath, term);
                if (!ok) {
                    invalidateCompileState(sketchDir);
                    return;
                }
                recordSuccessfulCompile(sketchDir, fqbn);
            }

            fs.writeFileSync(lockFile, 'busy', 'utf8');
            sendTerminalEcho(term, `=== Thruster: Flashing (Uploading) to ${port}... ===`, 'cyan');
            let flashAndMonitorCmd;
            if (isWin) {
                flashAndMonitorCmd = `try { & "${cliPath}" upload -p "${port}" --fqbn ${fqbn} "${sketchDir}"; $ec = $LASTEXITCODE } catch { $ec = 1 } finally { Set-Content -Path "${statusFile}" -Value $ec -Force; Remove-Item -Path "${lockFile}" -Force -ErrorAction SilentlyContinue }; if ($ec -eq 0) { Write-Host "\`n=== Thruster Serial Monitor (${port} @ ${baud} bps) - Press Ctrl+C to exit ===" -ForegroundColor Green; & "${cliPath}" monitor -p "${port}" -c baudrate=${baud} }`;
            } else {
                flashAndMonitorCmd = `"${cliPath}" upload -p "${port}" --fqbn ${fqbn} "${sketchDir}"; EC=$?; printf "%s" "$EC" > "${statusFile}"; rm -f "${lockFile}"; if [ $EC -eq 0 ]; then printf "\\033[1;32m\\n=== Thruster Serial Monitor (${port} @ ${baud} bps) - Press Ctrl+C to exit ===\\033[0m\\n"; "${cliPath}" monitor -p "${port}" -c baudrate=${baud}; fi`;
            }
            term.sendText(flashAndMonitorCmd);
            await waitForLockRelease(lockFile);

            let uploadSuccess = false;
            try {
                if (fs.existsSync(statusFile)) {
                    const statusVal = fs.readFileSync(statusFile, 'utf8').trim();
                    uploadSuccess = (statusVal === '0');
                    fs.unlinkSync(statusFile);
                }
            } catch (e) { }

            if (uploadSuccess) {
                isMonitoring = true;
                updateState();
            }
        } finally {
            try { if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile); } catch (e) { }
            try { if (fs.existsSync(statusFile)) fs.unlinkSync(statusFile); } catch (e) { }
            setBusy(false);
        }
    }));

    // Monitor Command
    context.subscriptions.push(vscode.commands.registerCommand('thruster.monitor', async () => {
        if (isBusy) {
            vscode.window.showWarningMessage("Thruster: Cannot open Serial Monitor while compile or flash is in progress.");
            return;
        }

        if (isMonitoring) {
            await stopSerialMonitor();
            vscode.window.showInformationMessage("Thruster: Exited Serial Monitor.", "Restart Monitor").then(choice => {
                if (choice === "Restart Monitor") {
                    vscode.commands.executeCommand('thruster.monitor');
                }
            });
            return;
        }

        const cliPath = await ensureArduinoCli();
        if (!cliPath) return;

        const config = loadConfig();
        const baud = (config && config.baudRate) || 115200;

        const port = await getOrResolvePort(config, cliPath);
        if (!port) {
            vscode.window.showErrorMessage("No USB serial port detected. Please connect your board.");
            return;
        }

        const term = getTerminal();
        term.show(true);
        sendTerminalEcho(term, `=== Thruster Serial Monitor (${port} @ ${baud} bps) - Press Ctrl+C to exit ===`, 'green');
        term.sendText(formatCliCmd(cliPath, `monitor -p "${port}" -c baudrate=${baud}`));
        isMonitoring = true;
        updateState();
    }));

    // Stop Monitor Command
    context.subscriptions.push(vscode.commands.registerCommand('thruster.stopMonitor', async () => {
        if (isMonitoring) {
            await stopSerialMonitor(true);
            vscode.window.showInformationMessage("Thruster: Serial Monitor stopped.");
        } else {
            vscode.window.showInformationMessage("Thruster: Serial Monitor is not running.");
        }
    }));

    // Select Port Command
    context.subscriptions.push(vscode.commands.registerCommand('thruster.selectPort', async () => {
        if (isBusy) {
            vscode.window.showWarningMessage("Thruster: Cannot change port while compile or flash is in progress.");
            return;
        }

        if (isMonitoring) {
            await stopSerialMonitor();
        }

        const cliPath = await ensureArduinoCli();
        if (!cliPath) return;

        const detected = await scanSerialPorts(cliPath);
        const items = [
            { label: "Auto-detect USB Port (Recommended)", port: "auto", description: "Dynamically select connected USB serial port" }
        ];
        detected.forEach(p => items.push({ label: p.label, port: p.address, description: "Port" }));
        items.push({
            label: "Manual input...",
            port: "manual",
            description: isWin ? "Enter COM port (e.g. COM3)" : "Enter serial device path (e.g. /dev/cu.usbserial-0001)"
        });

        const pick = await vscode.window.showQuickPick(items, { placeHolder: "Thruster: Select Serial Port" });
        if (!pick) return;

        let port = pick.port;
        if (port === "manual") {
            const manual = await vscode.window.showInputBox({
                prompt: isWin ? "Enter COM port (e.g. COM3)" : "Enter serial port (e.g. /dev/cu.usbserial-0001)"
            });
            if (!manual) return;
            port = manual.trim();
        }

        saveConfig({ port });
        updateState();
        vscode.window.showInformationMessage(`Thruster: Serial port set to ${port}`);
        if (settingsPanel) {
            settingsPanel.webview.html = getSettingsWebviewHtml(getSystemHealthState());
        }
    }));

    // Select Board Command (with core auto-installation)
    context.subscriptions.push(vscode.commands.registerCommand('thruster.selectBoard', async () => {
        if (isBusy) {
            vscode.window.showWarningMessage("Thruster: Cannot change board while compile or flash is in progress.");
            return;
        }

        if (isMonitoring) {
            await stopSerialMonitor();
        }

        const cliPath = await ensureArduinoCli();
        if (!cliPath) return;

        const boardInfo = await promptSelectBoard(cliPath);
        if (!boardInfo) return;

        saveConfig({ board: boardInfo.fqbn, boardName: boardInfo.boardName });
        updateState();
        vscode.window.showInformationMessage(`Thruster: Target board set to ${boardInfo.boardName}`);
        if (settingsPanel) {
            settingsPanel.webview.html = getSettingsWebviewHtml(getSystemHealthState());
        }
    }));

    // Scan & Install Missing Libraries Command
    context.subscriptions.push(vscode.commands.registerCommand('thruster.installLibraries', async () => {
        if (isBusy) {
            vscode.window.showWarningMessage("Thruster: Cannot scan libraries while compile or flash is in progress.");
            return;
        }

        if (isMonitoring) {
            await stopSerialMonitor();
        }

        const cliPath = await ensureArduinoCli();
        if (!cliPath) return;

        const sketchDir = getActiveSketchDir();
        if (!sketchDir) {
            vscode.window.showErrorMessage("No .ino sketch found. Please open an .ino file.");
            return;
        }
        const term = getTerminal();
        await scanAndInstallSketchLibraries(sketchDir, cliPath, term);
    }));

    // Setup / Locate arduino-cli Command
    context.subscriptions.push(vscode.commands.registerCommand('thruster.setupCli', async () => {
        if (isMonitoring) {
            await stopSerialMonitor();
        }

        const current = resolveArduinoCliPath();
        const statusMsg = current ? `Current: ${current}` : "Currently NOT found";

        const choices = [
            { label: "⚙️ Open Settings & Readiness Checklist", description: "Interactive dashboard with health check, configuration, and diagnostics", action: "settings" },
            { label: "⚡ One-Click Auto-Install arduino-cli", description: "Download and install official standalone arduino-cli binary", action: "install" },
            { label: "📂 Browse / Point to Path...", description: "Select an existing arduino-cli executable on your machine", action: "browse" },
            { label: "🔍 Auto-Detect on System", description: `Re-scan system PATH and standard directories (${statusMsg})`, action: "detect" }
        ];

        if (current) {
            choices.push({ label: "ℹ️ Check Version & Status", description: "Test current arduino-cli", action: "version" });
        }

        const pick = await vscode.window.showQuickPick(choices, {
            placeHolder: `Thruster: Configure arduino-cli (${statusMsg})`
        });
        if (!pick) return;

        if (pick.action === "settings") {
            openSettingsPanel(context);
        } else if (pick.action === "install") {
            await installArduinoCliOneClick();
        } else if (pick.action === "browse") {
            await promptLocateArduinoCli();
        } else if (pick.action === "detect") {
            const detected = resolveArduinoCliPath();
            if (detected) {
                await vscode.workspace.getConfiguration('thruster').update('arduinoCliPath', detected, vscode.ConfigurationTarget.Global);
                if (loadConfig()) {
                    saveConfig({ arduinoCliPath: detected });
                }
                vscode.window.showInformationMessage(`Thruster: Found and configured arduino-cli at: ${detected}`);
            } else {
                const installNow = await vscode.window.showWarningMessage(
                    "Thruster: arduino-cli was not found in any standard location. Would you like to auto-install it now?",
                    "⚡ Auto-Install", "Cancel"
                );
                if (installNow === "⚡ Auto-Install") {
                    await installArduinoCliOneClick();
                }
            }
        } else if (pick.action === "version") {
            try {
                const ver = cp.execSync(current === 'arduino-cli' ? 'arduino-cli version' : `"${current}" version`, { encoding: 'utf8' }).trim();
                vscode.window.showInformationMessage(`Thruster arduino-cli: ${ver}`);
            } catch (e) {
                vscode.window.showErrorMessage(`Thruster: Error running arduino-cli: ${e.message}`);
            }
        }
    }));
}

function deactivate() {
    if (isMonitoring && terminalInstance) {
        try {
            terminalInstance.sendText('\u0003', false);
        } catch (e) { }
    }
    if (terminalInstance) {
        terminalInstance.dispose();
    }
}

module.exports = {
    activate,
    deactivate
};
