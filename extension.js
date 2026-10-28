const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const os = require('os');
const https = require('https');
const http = require('http');

let terminalInstance = null;
let boardStatusBarItem = null;
let portStatusBarItem = null;
let initStatusBarItem = null;

const DEFAULT_CLI_PATH = "G:\\Arduino\\Arduino IDE\\resources\\app\\lib\\backend\\resources\\arduino-cli.exe";

const POPULAR_BOARDS = [
    { label: "NodeMCU-32S (ESP32)", fqbn: "esp32:esp32:nodemcu-32s", description: "Default NodeMCU ESP32-S (Xtensa Dual-Core)" },
    { label: "Nologo ESP32-C3 SuperMini", fqbn: "esp32:esp32:nologo_esp32c3_super_mini", description: "Super Mini RISC-V Board (Native USB)" },
    { label: "ESP32 Dev Module", fqbn: "esp32:esp32:esp32", description: "Generic ESP-WROOM-32" },
    { label: "ESP32-S3 Dev Module", fqbn: "esp32:esp32:esp32s3", description: "ESP32-S3 Dual-Core (USB OTG)" },
    { label: "Arduino Uno R3", fqbn: "arduino:avr:uno", description: "Classic ATmega328P Uno" },
    { label: "Arduino Uno R4 Minima", fqbn: "arduino:renesas_uno:minima", description: "Renesas RA4M1 32-bit Cortex-M4" },
    { label: "Arduino Uno R4 WiFi", fqbn: "arduino:renesas_uno:unor4wifi", description: "Renesas RA4M1 + ESP32-S3 WiFi" },
    { label: "Arduino Uno WiFi Rev2", fqbn: "arduino:megaavr:uno2018", description: "ATmega4809 with WiFi" },
    { label: "Arduino Due (Programming Port)", fqbn: "arduino:sam:arduino_due_x", description: "Atmel SAM3X8E ARM Cortex-M3 (Prog Port)" },
    { label: "Arduino Due (Native USB)", fqbn: "arduino:sam:arduino_due_x_dbg", description: "Atmel SAM3X8E (Native USB Port)" },
    { label: "Arduino Nano", fqbn: "arduino:avr:nano", description: "ATmega328P Nano" },
    { label: "Raspberry Pi Pico (RP2040)", fqbn: "rp2040:rp2040:rpipico", description: "RP2040 Dual ARM Cortex-M0+" },
    { label: "🔍 Search All Installed Boards...", fqbn: "search_installed", description: "Search any board installed in Arduino IDE / CLI" },
    { label: "Custom FQBN...", fqbn: "custom", description: "Specify a custom Fully Qualified Board Name" }
];

const KNOWN_CORE_INDEX_URLS = {
    'esp32:esp32': 'https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json',
    'esp8266:esp8266': 'https://arduino.esp8266.com/stable/package_esp8266com_index.json',
    'rp2040:rp2040': 'https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json'
};

const BUILTIN_HEADERS = new Set([
    'stdio', 'stdlib', 'stdint', 'stdbool', 'stddef', 'math', 'string', 'time',
    'vector', 'map', 'set', 'string_view', 'algorithm', 'memory', 'utility',
    'iostream', 'sstream', 'fstream', 'cstddef', 'cstdint', 'cstring', 'cmath'
]);

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

    // 4. Candidate locations
    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
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
            '/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli',
            '/usr/local/bin/arduino-cli',
            '/opt/homebrew/bin/arduino-cli',
            path.join(home, 'bin', 'arduino-cli'),
            path.join(home, 'Library', 'Arduino15', 'bin', 'arduino-cli')
        );
    } else {
        candidates.push(
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
    if (process.platform === 'win32') {
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

            const isWin = process.platform === 'win32';
            const isMac = process.platform === 'darwin';
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
            term.sendText(`Write-Host "=== Thruster: Downloading official arduino-cli from ${downloadUrl}... ===" -ForegroundColor Cyan`);

            await downloadFile(downloadUrl, tempArchive, (received, total) => {
                if (total > 0) {
                    const percent = Math.round((received / total) * 100);
                    const mbReceived = (received / (1024 * 1024)).toFixed(1);
                    const mbTotal = (total / (1024 * 1024)).toFixed(1);
                    progress.report({ message: `Downloading arduino-cli: ${percent}% (${mbReceived} MB / ${mbTotal} MB)...` });
                }
            });

            progress.report({ message: "Extracting arduino-cli binary..." });
            term.sendText(`Write-Host "=== Thruster: Extracting to ${installDir}... ===" -ForegroundColor Cyan`);
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
            term.sendText(`Write-Host "=== Thruster: Updating package index via arduino-cli... ===" -ForegroundColor Cyan`);
            try {
                cp.execSync(`"${targetExe}" core update-index`, { encoding: 'utf8', timeout: 35000 });
            } catch (e) {}

            term.sendText(`Write-Host "=== Thruster: arduino-cli setup successfully completed! ===" -ForegroundColor Green`);
            vscode.window.showInformationMessage(`Thruster: arduino-cli successfully installed to ${targetExe}`);

            return targetExe;
        } catch (err) {
            vscode.window.showErrorMessage(`Thruster: Failed to auto-install arduino-cli: ${err.message}. You can manually download it or point to an existing path.`);
            return null;
        }
    });
}

async function promptLocateArduinoCli() {
    const isWin = process.platform === 'win32';
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
        "Cancel"
    );

    if (choice === "⚡ One-Click Auto-Install") {
        return await installArduinoCliOneClick();
    } else if (choice === "📂 Browse / Point to Path...") {
        return await promptLocateArduinoCli();
    }

    return null;
}

function scanSerialPorts(cliPath) {
    return new Promise((resolve) => {
        const ports = [];
        try {
            const out = cp.execSync(`"${cliPath}" board list --json`, { encoding: 'utf8', timeout: 4000 });
            const parsed = JSON.parse(out);
            if (parsed && parsed.detected_ports) {
                for (const p of parsed.detected_ports) {
                    const addr = p.port && p.port.address;
                    const label = (p.port && (p.port.label || p.port.protocol_label)) || 'Serial Port';
                    if (addr) {
                        ports.push({ address: addr, label: `${addr} (${label})` });
                    }
                }
            }
        } catch (e) {
            try {
                const psOut = cp.execSync(`powershell -NoProfile -Command "[System.IO.Ports.SerialPort]::GetPortNames()"`, { encoding: 'utf8', timeout: 3000 });
                const lines = psOut.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
                for (const p of lines) {
                    ports.push({ address: p, label: `${p} (Serial Port)` });
                }
            } catch (err) { }
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
        const usbPorts = ports.filter(p => !p.address.toUpperCase().includes('COM1'));
        if (usbPorts.length > 0) {
            return usbPorts[0].address;
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
        terminalInstance = vscode.window.createTerminal("Thruster ESP32");
    }
    return terminalInstance;
}

function ensureCppProperties(root) {
    const propPath = path.join(root, '.vscode', 'c_cpp_properties.json');
    if (fs.existsSync(propPath)) return;

    const userHome = process.env.USERPROFILE || 'C:/Users/Default';
    const localAppData = process.env.LOCALAPPDATA || `${userHome}/AppData/Local`;

    const config = {
        configurations: [
            {
                name: "ESP32 NodeMCU-32S",
                includePath: [
                    "${workspaceFolder}/**",
                    `${localAppData}/Arduino15/packages/esp32/hardware/esp32/**/cores/esp32/**`,
                    `${localAppData}/Arduino15/packages/esp32/hardware/esp32/**/variants/nodemcu-32s/**`,
                    `${localAppData}/Arduino15/packages/esp32/hardware/esp32/**/libraries/**`,
                    `${userHome}/Documents/Arduino/libraries/**`
                ],
                defines: [
                    "ESP32",
                    "ARDUINO=10819",
                    "ARDUINO_ARCH_ESP32",
                    "ARDUINO_BOARD=\"NODEMCU_32S\"",
                    "F_CPU=240000000L"
                ],
                cStandard: "c11",
                cppStandard: "c++17",
                intelliSenseMode: "gcc-x64"
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
    term.sendText(`Write-Host "=== Thruster: Core package '${coreId}' is not yet installed ===" -ForegroundColor Yellow`);
    term.sendText(`Write-Host "=== Auto-downloading and installing '${coreId}' via arduino-cli... ===" -ForegroundColor Cyan`);
    if (additionalUrl) {
        term.sendText(`& "${cliPath}" core update-index${urlArgs}`);
    }
    term.sendText(`& "${cliPath}" core install ${coreId}${urlArgs}; if ($LASTEXITCODE -eq 0) { Write-Host "=== Core '${coreId}' installed successfully! ===" -ForegroundColor Green }`);

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
            prompt: "Enter custom FQBN (e.g. esp32:esp32:nodemcu-32s or arduino:avr:uno)",
            ignoreFocusOut: true
        });
        if (!customFqbn) return null;
        selectedFqbn = customFqbn.trim();
        selectedBoardName = selectedFqbn;
    }

    await ensureCoreInstalled(selectedFqbn, cliPath);

    return { fqbn: selectedFqbn, boardName: selectedBoardName };
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
        term.sendText(`Write-Host "=== Installing '${libName}' via arduino-cli... ===" -ForegroundColor Magenta`);
        cp.exec(`"${cliPath}" lib install "${libName}"`, { encoding: 'utf8', timeout: 90000 }, (err) => {
            if (!err) {
                term.sendText(`Write-Host "=== Successfully installed '${libName}'! ===" -ForegroundColor Green`);
                resolve(true);
            } else {
                term.sendText(`Write-Host "=== Failed to install '${libName}': ${err.message} ===" -ForegroundColor Red`);
                resolve(false);
            }
        });
    });
}

async function compileWithSmartResolver(sketchDir, fqbn, cliPath, term) {
    const resolverMode = vscode.workspace.getConfiguration('thruster').get('smartLibraryResolver', 'auto');
    const maxRetries = (resolverMode === 'off') ? 1 : 6;
    let attempt = 0;
    const installedInThisRun = new Set();

    term.show(true);

    while (attempt < maxRetries) {
        attempt++;
        term.sendText(`Write-Host "=== Thruster: Compiling Sketch... ===" -ForegroundColor Cyan`);

        const result = await new Promise((resolve) => {
            cp.exec(`"${cliPath}" compile --fqbn ${fqbn} "${sketchDir}"`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
                resolve({
                    success: !err,
                    output: (stdout || '') + '\n' + (stderr || '')
                });
            });
        });

        if (result.success) {
            term.sendText(`Write-Host "=== Thruster: Compilation Successful! ===" -ForegroundColor Green`);
            return true;
        }

        const missingHeader = findMissingHeader(result.output);

        if (!missingHeader || resolverMode === 'off') {
            term.sendText(`& "${cliPath}" compile --fqbn ${fqbn} "${sketchDir}"`);
            return false;
        }

        if (installedInThisRun.has(missingHeader.toLowerCase())) {
            term.sendText(`& "${cliPath}" compile --fqbn ${fqbn} "${sketchDir}"`);
            return false;
        }

        term.sendText(`Write-Host "=== Thruster Smart Resolver: Detected missing header <${missingHeader}.h> ===" -ForegroundColor Yellow`);

        const foundLib = await searchLibrary(missingHeader, cliPath);
        if (!foundLib) {
            term.sendText(`Write-Host "=== Thruster: No matching library found in registry for <${missingHeader}.h> ===" -ForegroundColor Red`);
            term.sendText(`& "${cliPath}" compile --fqbn ${fqbn} "${sketchDir}"`);
            return false;
        }

        if (resolverMode === 'with warning') {
            const userPick = await vscode.window.showWarningMessage(
                `Thruster: Missing header <${missingHeader}.h>. Found library "${foundLib}". Install now?`,
                "Install & Recompile", "Cancel"
            );
            if (userPick !== "Install & Recompile") {
                term.sendText(`& "${cliPath}" compile --fqbn ${fqbn} "${sketchDir}"`);
                return false;
            }
        }

        vscode.window.showInformationMessage(`[Thruster] Auto-installing missing library: "${foundLib}"...`);
        installedInThisRun.add(missingHeader.toLowerCase());

        const success = await installLibraryAsync(foundLib, cliPath, term);
        if (!success) {
            term.sendText(`& "${cliPath}" compile --fqbn ${fqbn} "${sketchDir}"`);
            return false;
        }
        term.sendText(`Write-Host "=== Installed '${foundLib}'! Recompiling... ===" -ForegroundColor Cyan`);
    }

    return false;
}

async function scanAndInstallSketchLibraries(sketchDir, cliPath, term) {
    term.show(true);
    term.sendText(`Write-Host "=== Thruster: Scanning Sketch for External Libraries... ===" -ForegroundColor Cyan`);

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

    term.sendText(`Write-Host "=== Found ${headers.size} candidate external library headers: ${Array.from(headers).join(', ')} ===" -ForegroundColor Yellow`);
    for (const h of headers) {
        const found = await searchLibrary(h, cliPath);
        if (found) {
            await installLibraryAsync(found, cliPath, term);
        } else {
            term.sendText(`Write-Host "=== Could not find registry library for <${h}.h> ===" -ForegroundColor Yellow`);
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
            portStatusBarItem.text = `$(plug) ${config.port || 'auto'}`;
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

function activate(context) {
    // 1. Setup Status Bar
    initStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    initStatusBarItem.command = 'thruster.init';
    initStatusBarItem.tooltip = 'Thruster: Initialize Arduino / ESP32 project settings';
    context.subscriptions.push(initStatusBarItem);

    boardStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    boardStatusBarItem.command = 'thruster.selectBoard';
    boardStatusBarItem.tooltip = 'Thruster: Click to switch target board';
    context.subscriptions.push(boardStatusBarItem);

    portStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    portStatusBarItem.command = 'thruster.selectPort';
    portStatusBarItem.tooltip = 'Thruster: Click to select Serial COM port';
    context.subscriptions.push(portStatusBarItem);

    // Watch config file changes
    const watcher = vscode.workspace.createFileSystemWatcher('**/.vscode/arduino.json');
    watcher.onDidCreate(() => updateState());
    watcher.onDidChange(() => updateState());
    watcher.onDidDelete(() => updateState());
    context.subscriptions.push(watcher);

    updateState();

    // 2. Register Commands
    context.subscriptions.push(vscode.commands.registerCommand('thruster.init', async () => {
        if (isBusy) {
            vscode.window.showWarningMessage("Thruster: A compile or flash task is already in progress.");
            return;
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
            { label: "Auto-detect USB Port (Recommended)", port: "auto", description: "Automatically finds the USB COM port on each flash" }
        ];
        detectedPorts.forEach(p => {
            portChoices.push({ label: p.label, port: p.address, description: "Fixed serial port" });
        });
        portChoices.push({ label: "Enter COM port manually...", port: "manual", description: "e.g. COM3 or /dev/ttyUSB0" });

        const portPick = await vscode.window.showQuickPick(portChoices, {
            placeHolder: "Thruster: Select upload serial port",
            ignoreFocusOut: true
        });
        if (!portPick) return;

        let selectedPort = portPick.port;
        if (selectedPort === 'manual') {
            const manualPort = await vscode.window.showInputBox({
                prompt: "Enter COM port (e.g. COM3)",
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
                vscode.window.showInformationMessage("Thruster: Compilation verified successfully!");
            }
        } finally {
            setBusy(false);
        }
    }));

    // Flash Command (with Smart Library Resolver & Busy Lock)
    context.subscriptions.push(vscode.commands.registerCommand('thruster.flash', async () => {
        if (isBusy) {
            vscode.window.showWarningMessage("Thruster: A compile or flash task is already in progress.");
            return;
        }

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
            vscode.window.showErrorMessage("No USB serial port detected. Please plug in your board or set COM port via status bar.");
            return;
        }

        const term = getTerminal();
        const lockFile = path.join(os.tmpdir(), `thruster_flash_${Date.now()}.lock`);

        try {
            setBusy(true);
            const ok = await compileWithSmartResolver(sketchDir, fqbn, cliPath, term);
            if (ok) {
                fs.writeFileSync(lockFile, 'busy', 'utf8');
                term.sendText(`Write-Host "=== Thruster: Flashing (Uploading) to ${port}... ===" -ForegroundColor Cyan`);
                const uploadCmd = `try { & "${cliPath}" upload -p ${port} --fqbn ${fqbn} "${sketchDir}" } finally { Remove-Item -Path "${lockFile}" -Force -ErrorAction SilentlyContinue }`;
                term.sendText(uploadCmd);
                await waitForLockRelease(lockFile);
            }
        } finally {
            try { if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile); } catch (e) { }
            setBusy(false);
        }
    }));

    // Flash & Monitor Command (with Smart Library Resolver & Busy Lock)
    context.subscriptions.push(vscode.commands.registerCommand('thruster.flashAndMonitor', async () => {
        if (isBusy) {
            vscode.window.showWarningMessage("Thruster: A compile or flash task is already in progress.");
            return;
        }

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
            vscode.window.showErrorMessage("No USB serial port detected. Please plug in your board or set COM port via status bar.");
            return;
        }

        const term = getTerminal();
        const lockFile = path.join(os.tmpdir(), `thruster_flash_${Date.now()}.lock`);

        try {
            setBusy(true);
            const ok = await compileWithSmartResolver(sketchDir, fqbn, cliPath, term);
            if (ok) {
                fs.writeFileSync(lockFile, 'busy', 'utf8');
                term.sendText(`Write-Host "=== Thruster: Flashing (Uploading) to ${port}... ===" -ForegroundColor Cyan`);
                const flashAndMonitorCmd = `try { & "${cliPath}" upload -p ${port} --fqbn ${fqbn} "${sketchDir}" } finally { Remove-Item -Path "${lockFile}" -Force -ErrorAction SilentlyContinue }; if ($LASTEXITCODE -eq 0) { Write-Host "\`n=== Thruster Serial Monitor (${port} @ ${baud} bps) - Press Ctrl+C to exit ===" -ForegroundColor Green; & "${cliPath}" monitor -p ${port} -c baudrate=${baud} }`;
                term.sendText(flashAndMonitorCmd);
                await waitForLockRelease(lockFile);
            }
        } finally {
            try { if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile); } catch (e) { }
            setBusy(false);
        }
    }));

    // Monitor Command
    context.subscriptions.push(vscode.commands.registerCommand('thruster.monitor', async () => {
        if (isBusy) {
            vscode.window.showWarningMessage("Thruster: Cannot open Serial Monitor while compile or flash is in progress.");
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
        const cmd = `& "${cliPath}" monitor -p ${port} -c baudrate=${baud}`;
        term.sendText(cmd);
    }));

    // Select Port Command
    context.subscriptions.push(vscode.commands.registerCommand('thruster.selectPort', async () => {
        if (isBusy) {
            vscode.window.showWarningMessage("Thruster: Cannot change port while compile or flash is in progress.");
            return;
        }

        const cliPath = await ensureArduinoCli();
        if (!cliPath) return;

        const detected = await scanSerialPorts(cliPath);
        const items = [
            { label: "Auto-detect USB Port (Recommended)", port: "auto", description: "Dynamically select USB COM port" }
        ];
        detected.forEach(p => items.push({ label: p.label, port: p.address, description: "Port" }));
        items.push({ label: "Manual input...", port: "manual", description: "Enter COM port" });

        const pick = await vscode.window.showQuickPick(items, { placeHolder: "Thruster: Select Serial Port" });
        if (!pick) return;

        let port = pick.port;
        if (port === "manual") {
            const manual = await vscode.window.showInputBox({ prompt: "Enter COM port (e.g. COM3)" });
            if (!manual) return;
            port = manual.trim();
        }

        saveConfig({ port });
        updateState();
        vscode.window.showInformationMessage(`Thruster: Serial port set to ${port}`);
    }));

    // Select Board Command (with core auto-installation)
    context.subscriptions.push(vscode.commands.registerCommand('thruster.selectBoard', async () => {
        if (isBusy) {
            vscode.window.showWarningMessage("Thruster: Cannot change board while compile or flash is in progress.");
            return;
        }

        const cliPath = await ensureArduinoCli();
        if (!cliPath) return;

        const boardInfo = await promptSelectBoard(cliPath);
        if (!boardInfo) return;

        saveConfig({ board: boardInfo.fqbn, boardName: boardInfo.boardName });
        updateState();
        vscode.window.showInformationMessage(`Thruster: Target board set to ${boardInfo.boardName}`);
    }));

    // Scan & Install Missing Libraries Command
    context.subscriptions.push(vscode.commands.registerCommand('thruster.installLibraries', async () => {
        if (isBusy) {
            vscode.window.showWarningMessage("Thruster: Cannot scan libraries while compile or flash is in progress.");
            return;
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
        const current = resolveArduinoCliPath();
        const statusMsg = current ? `Current: ${current}` : "Currently NOT found";

        const choices = [
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

        if (pick.action === "install") {
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
    if (terminalInstance) {
        terminalInstance.dispose();
    }
}

module.exports = {
    activate,
    deactivate
};
