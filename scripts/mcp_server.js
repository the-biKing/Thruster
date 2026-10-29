#!/usr/bin/env node
/**
 * Thruster MCP Server (Model Context Protocol)
 * Enables AI Agents (Antigravity IDE, Claude, etc.) to perform the autonomous MCU development loop:
 *   Compile -> Flash -> Test (via Serial Monitor) -> Refactor
 *
 * Designed with ZERO external dependencies (Node.js standard library only).
 * Compatible with macOS, Linux, and Windows.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const readline = require('readline');

const SERVER_NAME = 'thruster-mcp';
const SERVER_VERSION = '1.0.0';
const PROTOCOL_VERSION = '2024-11-05';

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

// ==========================================
// 1. Path & Configuration Resolvers
// ==========================================

function getWorkspaceRoot() {
    return process.cwd();
}

function checkBinaryRunnable(binaryPath) {
    try {
        const res = cp.spawnSync(binaryPath, ['version'], {
            timeout: 5000,
            encoding: 'utf8',
            shell: isWin
        });
        return res.status === 0;
    } catch (e) {
        return false;
    }
}

function resolveArduinoCliPath(workspaceRoot = getWorkspaceRoot()) {
    // 1. Check workspace config (.vscode/arduino.json)
    const configPath = path.join(workspaceRoot, '.vscode', 'arduino.json');
    if (fs.existsSync(configPath)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (parsed.arduinoCliPath && checkBinaryRunnable(parsed.arduinoCliPath)) {
                return parsed.arduinoCliPath;
            }
        } catch (e) {}
    }

    // 2. Check system PATH
    if (checkBinaryRunnable('arduino-cli')) {
        return 'arduino-cli';
    }

    // 3. Candidate directories
    const home = os.homedir();
    const binName = isWin ? 'arduino-cli.exe' : 'arduino-cli';
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
            path.join(home, 'arduino-cli', 'arduino-cli.exe')
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

function loadMcuConfig(workspaceRoot = getWorkspaceRoot()) {
    const configPath = path.join(workspaceRoot, '.vscode', 'arduino.json');
    let config = {
        board: 'esp32:esp32:nodemcu-32s',
        boardName: 'ESP32 NodeMCU-32S',
        port: 'auto',
        baudRate: 115200,
        sketch: null,
        arduinoCliPath: null
    };

    if (fs.existsSync(configPath)) {
        try {
            const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            config = Object.assign(config, raw);
        } catch (e) {}
    }

    config.arduinoCliPath = resolveArduinoCliPath(workspaceRoot);
    if (!config.sketch) {
        config.sketch = findActiveSketch(workspaceRoot);
    }
    return config;
}

function saveMcuConfig(updates, workspaceRoot = getWorkspaceRoot()) {
    const vscodeDir = path.join(workspaceRoot, '.vscode');
    if (!fs.existsSync(vscodeDir)) {
        fs.mkdirSync(vscodeDir, { recursive: true });
    }
    const configPath = path.join(vscodeDir, 'arduino.json');
    let current = {};
    if (fs.existsSync(configPath)) {
        try {
            current = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (e) {}
    }
    const merged = Object.assign(current, updates);
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 4), 'utf8');
    return merged;
}

function findActiveSketch(workspaceRoot = getWorkspaceRoot()) {
    // 1. Check if workspace root has an .ino file
    try {
        const files = fs.readdirSync(workspaceRoot);
        for (const file of files) {
            if (file.endsWith('.ino')) {
                return path.join(workspaceRoot, file);
            }
        }
    } catch (e) {}

    // 2. Check immediate subfolders
    try {
        const items = fs.readdirSync(workspaceRoot, { withFileTypes: true });
        for (const item of items) {
            if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules' && item.name !== 'build') {
                const subDir = path.join(workspaceRoot, item.name);
                const subFiles = fs.readdirSync(subDir);
                for (const sf of subFiles) {
                    if (sf.endsWith('.ino')) {
                        return path.join(subDir, sf);
                    }
                }
            }
        }
    } catch (e) {}

    return null;
}

function detectAutoPort(cliPath) {
    if (!cliPath) return null;
    try {
        const res = cp.spawnSync(cliPath, ['board', 'list', '--format', 'json'], {
            encoding: 'utf8',
            timeout: 5000,
            shell: isWin
        });
        if (res.status === 0 && res.stdout) {
            const data = JSON.parse(res.stdout);
            const detectedPorts = data.detected_ports || data;
            if (Array.isArray(detectedPorts)) {
                for (const p of detectedPorts) {
                    const addr = (p.port && p.port.address) || p.address;
                    const protocol = (p.port && p.port.protocol) || p.protocol;
                    if (addr && (protocol === 'serial' || addr.includes('usb') || addr.includes('COM') || addr.includes('cu.'))) {
                        return addr;
                    }
                }
            }
        }
    } catch (e) {}
    return null;
}

// ==========================================
// 2. Output Parsers (Memory & Errors)
// ==========================================

function parseMemoryUsage(output) {
    const memory = {
        flash: null,
        ram: null
    };

    if (!output) return memory;

    // Pattern 1: Arduino-CLI / GCC flash pattern
    // "Sketch uses 261893 bytes (20%) of program storage space. Maximum is 1310720 bytes."
    const flashMatch = output.match(/Sketch uses\s+([0-9,]+)\s+bytes\s+\(?([0-9]+)%\)?\s+of program storage space\.\s+Maximum is\s+([0-9,]+)\s+bytes/i);
    if (flashMatch) {
        const used = parseInt(flashMatch[1].replace(/,/g, ''), 10);
        const percent = parseInt(flashMatch[2], 10);
        const max = parseInt(flashMatch[3].replace(/,/g, ''), 10);
        memory.flash = {
            used,
            max,
            percent,
            free: Math.max(0, max - used)
        };
    }

    // Pattern 2: Global variables / RAM pattern
    // "Global variables use 21456 bytes (6%) of dynamic memory, leaving 306224 bytes for local variables. Maximum is 327680 bytes."
    const ramMatch = output.match(/Global variables use\s+([0-9,]+)\s+bytes\s+\(?([0-9]+)%\)?\s+of dynamic memory(?:.*?Maximum is\s+([0-9,]+)\s+bytes)?/i);
    if (ramMatch) {
        const used = parseInt(ramMatch[1].replace(/,/g, ''), 10);
        const percent = parseInt(ramMatch[2], 10);
        const max = ramMatch[3] ? parseInt(ramMatch[3].replace(/,/g, ''), 10) : 0;
        memory.ram = {
            used,
            max,
            percent,
            free: max > 0 ? Math.max(0, max - used) : 0
        };
    }

    return memory;
}

function parseCompilerErrors(output) {
    const errors = [];
    if (!output) return errors;

    const lines = output.split('\n');
    const errorRegex = /^([^:\n]+):(\d+):(?:\d+:)?\s*(fatal error|error):\s*(.*)$/i;

    for (const line of lines) {
        const match = line.trim().match(errorRegex);
        if (match) {
            errors.push({
                file: path.basename(match[1]),
                path: match[1],
                line: parseInt(match[2], 10),
                severity: match[3].toLowerCase(),
                message: match[4]
            });
        }
    }
    return errors;
}

function parseTestResults(logs) {
    const passes = [];
    const failures = [];
    let summary = null;

    const lines = logs.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('[TEST:PASS]')) {
            passes.push(trimmed.replace('[TEST:PASS]', '').trim());
        } else if (trimmed.startsWith('[TEST:FAIL]')) {
            failures.push(trimmed.replace('[TEST:FAIL]', '').trim());
        } else if (trimmed.startsWith('[TEST:SUMMARY]')) {
            // [TEST:SUMMARY] total=X, passed=Y, failed=Z
            const m = trimmed.match(/total=(\d+),\s*passed=(\d+),\s*failed=(\d+)/i);
            if (m) {
                summary = {
                    total: parseInt(m[1], 10),
                    passed: parseInt(m[2], 10),
                    failed: parseInt(m[3], 10)
                };
            }
        }
    }

    if (!summary) {
        summary = {
            total: passes.length + failures.length,
            passed: passes.length,
            failed: failures.length
        };
    }

    let status = 'UNKNOWN';
    if (summary.total > 0) {
        status = summary.failed === 0 ? 'PASS' : 'FAIL';
    }

    return {
        status,
        summary,
        passed_tests: passes,
        failed_tests: failures
    };
}

// ==========================================
// 3. Core Tool Handlers
// ==========================================

async function toolCompileSketch(args) {
    const config = loadMcuConfig();
    const cliPath = config.arduinoCliPath;

    if (!cliPath) {
        return {
            isError: true,
            error: "arduino-cli executable not found. Please install arduino-cli or configure 'arduinoCliPath' in .vscode/arduino.json."
        };
    }

    const sketchPath = args.sketch_path || config.sketch;
    if (!sketchPath || !fs.existsSync(sketchPath)) {
        return {
            isError: true,
            error: `Target sketch file not found: "${sketchPath}". Please open or specify an .ino sketch.`
        };
    }

    const fqbn = args.fqbn || config.board;
    if (!fqbn) {
        return {
            isError: true,
            error: "FQBN (board architecture) not specified. Please configure 'board' in .vscode/arduino.json (e.g. 'esp32:esp32:nodemcu-32s')."
        };
    }

    const sketchDir = fs.statSync(sketchPath).isDirectory() ? sketchPath : path.dirname(sketchPath);

    const cmdArgs = ['compile', '--fqbn', fqbn, sketchDir];
    if (args.test_mode) {
        cmdArgs.push('--build-property', 'build.extra_flags="-DTHRUSTER_TEST_MODE=1"');
    }

    const result = await new Promise((resolve) => {
        const proc = cp.spawn(cliPath, cmdArgs, {
            cwd: sketchDir,
            shell: isWin,
            env: process.env
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => { stderr += d.toString(); });

        proc.on('close', (code) => {
            const fullOutput = stdout + (stderr ? '\n' + stderr : '');
            resolve({
                code,
                output: fullOutput
            });
        });
        proc.on('error', (err) => {
            resolve({
                code: 1,
                output: err.message
            });
        });
    });

    const isSuccess = result.code === 0;
    const memory = parseMemoryUsage(result.output);
    const errors = parseCompilerErrors(result.output);

    return {
        success: isSuccess,
        fqbn,
        sketch: sketchPath,
        test_mode_enabled: !!args.test_mode,
        memory,
        errors: errors.length > 0 ? errors : undefined,
        raw_output: result.output.trim()
    };
}

async function toolFlashSketch(args) {
    const config = loadMcuConfig();
    const cliPath = config.arduinoCliPath;

    if (!cliPath) {
        return {
            isError: true,
            error: "arduino-cli executable not found. Please install arduino-cli or configure 'arduinoCliPath' in .vscode/arduino.json."
        };
    }

    const sketchPath = args.sketch_path || config.sketch;
    if (!sketchPath || !fs.existsSync(sketchPath)) {
        return {
            isError: true,
            error: `Target sketch file not found: "${sketchPath}".`
        };
    }

    const fqbn = args.fqbn || config.board;
    let port = args.port || config.port;

    if (!port || port === 'auto') {
        const auto = detectAutoPort(cliPath);
        if (auto) {
            port = auto;
        } else {
            return {
                isError: true,
                error: "No connected USB microcontroller detected automatically. Please specify a serial port (e.g., COM3 or /dev/cu.usbserial-*)."
            };
        }
    }

    const sketchDir = fs.statSync(sketchPath).isDirectory() ? sketchPath : path.dirname(sketchPath);

    const cmdArgs = ['upload', '-p', port, '--fqbn', fqbn, sketchDir];

    const result = await new Promise((resolve) => {
        const proc = cp.spawn(cliPath, cmdArgs, {
            cwd: sketchDir,
            shell: isWin,
            env: process.env
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => { stderr += d.toString(); });

        proc.on('close', (code) => {
            const fullOutput = stdout + (stderr ? '\n' + stderr : '');
            resolve({
                code,
                output: fullOutput
            });
        });
        proc.on('error', (err) => {
            resolve({
                code: 1,
                output: err.message
            });
        });
    });

    return {
        success: result.code === 0,
        port,
        fqbn,
        sketch: sketchPath,
        raw_output: result.output.trim()
    };
}

async function toolRunSerialTest(args) {
    const config = loadMcuConfig();
    const cliPath = config.arduinoCliPath;

    if (!cliPath) {
        return {
            isError: true,
            error: "arduino-cli executable not found."
        };
    }

    let port = args.port || config.port;
    if (!port || port === 'auto') {
        const auto = detectAutoPort(cliPath);
        if (auto) {
            port = auto;
        } else {
            return {
                isError: true,
                error: "Serial port could not be resolved automatically."
            };
        }
    }

    const baud = args.baud_rate || config.baudRate || 115200;
    const command = args.command || 'CMD:TEST:ALL';
    const timeoutMs = args.timeout_ms || 6000;
    const expectedPattern = args.expected_pattern ? new RegExp(args.expected_pattern, 'i') : /\[TEST:SUMMARY\]|\[TEST:PASS\]|\[TEST:FAIL\]/i;

    return new Promise((resolve) => {
        let logs = '';
        let matched = false;
        let commandSent = false;

        const monitorArgs = ['monitor', '-p', port, '-c', `baudrate=${baud}`];
        const proc = cp.spawn(cliPath, monitorArgs, {
            shell: isWin,
            env: process.env
        });

        const timer = setTimeout(() => {
            cleanup();
            const analysis = parseTestResults(logs);
            if (analysis.status === 'UNKNOWN') {
                analysis.status = 'TIMEOUT';
            }
            resolve({
                status: analysis.status,
                matched: matched,
                timed_out: true,
                port,
                baud_rate: baud,
                command_sent: command,
                summary: analysis.summary,
                passed_tests: analysis.passed_tests,
                failed_tests: analysis.failed_tests,
                logs: logs.trim()
            });
        }, timeoutMs);

        function cleanup() {
            clearTimeout(timer);
            try {
                if (!proc.killed) {
                    if (isWin) {
                        cp.exec(`taskkill /pid ${proc.pid} /T /F`);
                    } else {
                        proc.kill('SIGINT');
                        setTimeout(() => {
                            try { proc.kill('SIGKILL'); } catch (e) {}
                        }, 200);
                    }
                }
            } catch (e) {}
        }

        proc.stdout.on('data', (d) => {
            const str = d.toString();
            logs += str;

            if (expectedPattern && expectedPattern.test(logs)) {
                matched = true;
                // Give 400ms buffer to collect any remaining summary lines
                setTimeout(() => {
                    cleanup();
                    const analysis = parseTestResults(logs);
                    resolve({
                        status: analysis.status,
                        matched: true,
                        timed_out: false,
                        port,
                        baud_rate: baud,
                        command_sent: command,
                        summary: analysis.summary,
                        passed_tests: analysis.passed_tests,
                        failed_tests: analysis.failed_tests,
                        logs: logs.trim()
                    });
                }, 400);
            }
        });

        proc.stderr.on('data', (d) => {
            logs += d.toString();
        });

        proc.on('error', (err) => {
            cleanup();
            resolve({
                status: 'ERROR',
                error: err.message,
                logs
            });
        });

        // Microcontrollers (especially ESP32 / Arduino) toggle DTR/RTS and reboot when serial connects.
        // Wait 700ms for reboot to complete before sending test trigger command.
        setTimeout(() => {
            if (!proc.killed && proc.stdin.writable) {
                proc.stdin.write(command + '\n');
                commandSent = true;
            }
        }, 700);
    });
}

async function toolReadSerial(args) {
    const config = loadMcuConfig();
    const cliPath = config.arduinoCliPath;

    if (!cliPath) {
        return { isError: true, error: "arduino-cli executable not found." };
    }

    let port = args.port || config.port;
    if (!port || port === 'auto') {
        port = detectAutoPort(cliPath) || port;
    }
    const baud = args.baud_rate || config.baudRate || 115200;
    const durationMs = Math.min(args.duration_ms || 3000, 15000);
    const maxLines = args.max_lines || 100;

    return new Promise((resolve) => {
        let logs = '';
        let lineCount = 0;

        const monitorArgs = ['monitor', '-p', port, '-c', `baudrate=${baud}`];
        const proc = cp.spawn(cliPath, monitorArgs, {
            shell: isWin,
            env: process.env
        });

        const timer = setTimeout(() => {
            cleanup();
            resolve({
                port,
                baud_rate: baud,
                line_count: lineCount,
                logs: logs.trim()
            });
        }, durationMs);

        function cleanup() {
            clearTimeout(timer);
            try {
                if (!proc.killed) {
                    if (isWin) {
                        cp.exec(`taskkill /pid ${proc.pid} /T /F`);
                    } else {
                        proc.kill('SIGINT');
                        setTimeout(() => {
                            try { proc.kill('SIGKILL'); } catch (e) {}
                        }, 200);
                    }
                }
            } catch (e) {}
        }

        proc.stdout.on('data', (d) => {
            const str = d.toString();
            logs += str;
            lineCount = logs.split('\n').length;
            if (lineCount >= maxLines) {
                cleanup();
                resolve({
                    port,
                    baud_rate: baud,
                    line_count: lineCount,
                    logs: logs.trim()
                });
            }
        });

        proc.stderr.on('data', (d) => { logs += d.toString(); });
        proc.on('error', (err) => {
            cleanup();
            resolve({ isError: true, error: err.message, logs });
        });
    });
}

async function toolWriteSerial(args) {
    const config = loadMcuConfig();
    const cliPath = config.arduinoCliPath;

    if (!cliPath) {
        return { isError: true, error: "arduino-cli executable not found." };
    }

    let port = args.port || config.port;
    if (!port || port === 'auto') {
        port = detectAutoPort(cliPath) || port;
    }
    const baud = args.baud_rate || config.baudRate || 115200;
    const text = args.text || '';
    const waitResponseMs = Math.min(args.wait_response_ms || 1000, 5000);

    return new Promise((resolve) => {
        let logs = '';
        const monitorArgs = ['monitor', '-p', port, '-c', `baudrate=${baud}`];
        const proc = cp.spawn(cliPath, monitorArgs, {
            shell: isWin,
            env: process.env
        });

        function cleanup() {
            try {
                if (!proc.killed) {
                    if (isWin) {
                        cp.exec(`taskkill /pid ${proc.pid} /T /F`);
                    } else {
                        proc.kill('SIGINT');
                        setTimeout(() => {
                            try { proc.kill('SIGKILL'); } catch (e) {}
                        }, 200);
                    }
                }
            } catch (e) {}
        }

        proc.stdout.on('data', (d) => { logs += d.toString(); });
        proc.stderr.on('data', (d) => { logs += d.toString(); });

        setTimeout(() => {
            if (!proc.killed && proc.stdin.writable) {
                proc.stdin.write(text + '\n');
            }
            setTimeout(() => {
                cleanup();
                resolve({
                    sent: text,
                    port,
                    baud_rate: baud,
                    response: logs.trim()
                });
            }, waitResponseMs);
        }, 500);

        proc.on('error', (err) => {
            cleanup();
            resolve({ isError: true, error: err.message });
        });
    });
}

async function toolGetMcuConfig() {
    const config = loadMcuConfig();
    const autoPort = detectAutoPort(config.arduinoCliPath);
    return {
        board: config.board,
        boardName: config.boardName,
        configured_port: config.port,
        detected_auto_port: autoPort,
        effective_port: (config.port === 'auto' && autoPort) ? autoPort : config.port,
        baud_rate: config.baudRate,
        sketch: config.sketch,
        arduino_cli_path: config.arduinoCliPath,
        cli_available: !!config.arduinoCliPath
    };
}

async function toolSetMcuConfig(args) {
    const updates = {};
    if (args.fqbn) updates.board = args.fqbn;
    if (args.board_name) updates.boardName = args.board_name;
    if (args.port) updates.port = args.port;
    if (args.baud_rate) updates.baudRate = parseInt(args.baud_rate, 10);
    if (args.sketch_path) updates.sketch = args.sketch_path;

    const saved = saveMcuConfig(updates);
    return {
        updated: true,
        current_config: saved
    };
}

// ==========================================
// 4. MCP Tools Registry
// ==========================================

const TOOLS = [
    {
        name: 'compile_sketch',
        description: 'Compiles the MCU sketch using arduino-cli. Returns compilation status, detailed line-by-line compiler errors, and Flash/RAM memory metrics.',
        inputSchema: {
            type: 'object',
            properties: {
                sketch_path: {
                    type: 'string',
                    description: 'Optional path to the .ino file or sketch directory. Defaults to active sketch in workspace.'
                },
                fqbn: {
                    type: 'string',
                    description: 'Target board FQBN (e.g. "esp32:esp32:nodemcu-32s", "arduino:avr:uno"). Defaults to configured board.'
                },
                test_mode: {
                    type: 'boolean',
                    description: 'If true, defines THRUSTER_TEST_MODE=1 during compilation to enable detachable test suites.'
                }
            }
        }
    },
    {
        name: 'flash_sketch',
        description: 'Uploads / flashes the compiled sketch binary to the target microcontroller over Serial. Automatically detects connected USB port if set to auto.',
        inputSchema: {
            type: 'object',
            properties: {
                sketch_path: {
                    type: 'string',
                    description: 'Optional path to sketch file or directory.'
                },
                port: {
                    type: 'string',
                    description: 'Target serial port (e.g. "COM3", "/dev/cu.usbserial-0001", or "auto").'
                },
                fqbn: {
                    type: 'string',
                    description: 'Board FQBN.'
                }
            }
        }
    },
    {
        name: 'run_serial_test',
        description: 'Executes an automated test over Serial. Connects to the MCU, sends a test stimulus command, captures test assertion outputs ([TEST:PASS], [TEST:FAIL], [TEST:SUMMARY]), and cleanly closes the port so it can be reused immediately.',
        inputSchema: {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    description: 'Test stimulus command to send over serial (e.g. "CMD:TEST:ALL", "CMD:EVENT:BUTTON_PRESS:1"). Default: "CMD:TEST:ALL".'
                },
                expected_pattern: {
                    type: 'string',
                    description: 'Optional regex pattern indicating test completion. Default matches [TEST:SUMMARY], [TEST:PASS], or [TEST:FAIL].'
                },
                timeout_ms: {
                    type: 'number',
                    description: 'Maximum milliseconds to wait for test output. Default: 6000ms.'
                },
                port: {
                    type: 'string',
                    description: 'Serial port. Defaults to configured/auto port.'
                },
                baud_rate: {
                    type: 'number',
                    description: 'Serial baud rate. Default: 115200.'
                }
            }
        }
    },
    {
        name: 'read_serial',
        description: 'Reads serial output from the microcontroller for a specified duration or up to a maximum number of lines.',
        inputSchema: {
            type: 'object',
            properties: {
                duration_ms: {
                    type: 'number',
                    description: 'Time to listen in milliseconds (default: 3000ms, max: 15000ms).'
                },
                max_lines: {
                    type: 'number',
                    description: 'Maximum lines to read before stopping (default: 100).'
                },
                port: {
                    type: 'string',
                    description: 'Serial port.'
                },
                baud_rate: {
                    type: 'number',
                    description: 'Baud rate (default: 115200).'
                }
            }
        }
    },
    {
        name: 'write_serial',
        description: 'Sends a command or string over Serial to the microcontroller and returns any immediate response.',
        inputSchema: {
            type: 'object',
            properties: {
                text: {
                    type: 'string',
                    description: 'Text string or command to transmit.'
                },
                wait_response_ms: {
                    type: 'number',
                    description: 'Milliseconds to wait for reply (default: 1000ms).'
                },
                port: {
                    type: 'string',
                    description: 'Serial port.'
                },
                baud_rate: {
                    type: 'number',
                    description: 'Baud rate.'
                }
            },
            required: ['text']
        }
    },
    {
        name: 'get_mcu_config',
        description: 'Returns the current microcontroller configuration: board FQBN, board name, configured port, detected port, baud rate, and sketch path.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'set_mcu_config',
        description: 'Updates Thruster MCU configuration (.vscode/arduino.json) such as FQBN, port, or baud rate.',
        inputSchema: {
            type: 'object',
            properties: {
                fqbn: {
                    type: 'string',
                    description: 'Board FQBN (e.g. "esp32:esp32:nodemcu-32s").'
                },
                board_name: {
                    type: 'string',
                    description: 'Human-readable board name.'
                },
                port: {
                    type: 'string',
                    description: 'Serial port address or "auto".'
                },
                baud_rate: {
                    type: 'number',
                    description: 'Serial baud rate.'
                },
                sketch_path: {
                    type: 'string',
                    description: 'Active .ino sketch path.'
                }
            }
        }
    }
];

// ==========================================
// 5. JSON-RPC 2.0 / MCP Stdio Dispatcher
// ==========================================

function sendJsonRpc(message) {
    process.stdout.write(JSON.stringify(message) + '\n');
}

function handleInitialize(id, params) {
    sendJsonRpc({
        jsonrpc: '2.0',
        id,
        result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {
                tools: {}
            },
            serverInfo: {
                name: SERVER_NAME,
                version: SERVER_VERSION
            }
        }
    });
}

function handleToolsList(id) {
    sendJsonRpc({
        jsonrpc: '2.0',
        id,
        result: {
            tools: TOOLS
        }
    });
}

async function handleToolCall(id, params) {
    const name = params && params.name;
    const args = (params && params.arguments) || {};

    let result;
    let isError = false;

    try {
        switch (name) {
            case 'compile_sketch':
                result = await toolCompileSketch(args);
                break;
            case 'flash_sketch':
                result = await toolFlashSketch(args);
                break;
            case 'run_serial_test':
                result = await toolRunSerialTest(args);
                break;
            case 'read_serial':
                result = await toolReadSerial(args);
                break;
            case 'write_serial':
                result = await toolWriteSerial(args);
                break;
            case 'get_mcu_config':
                result = await toolGetMcuConfig();
                break;
            case 'set_mcu_config':
                result = await toolSetMcuConfig(args);
                break;
            default:
                isError = true;
                result = { error: `Unknown tool name: ${name}` };
                break;
        }
    } catch (err) {
        isError = true;
        result = { error: err.message, stack: err.stack };
    }

    if (result && result.isError) {
        isError = true;
    }

    sendJsonRpc({
        jsonrpc: '2.0',
        id,
        result: {
            content: [
                {
                    type: 'text',
                    text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
                }
            ],
            isError
        }
    });
}

// Start stdio event loop
function main() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
    });

    rl.on('line', async (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        let message;
        try {
            message = JSON.parse(trimmed);
        } catch (e) {
            sendJsonRpc({
                jsonrpc: '2.0',
                id: null,
                error: { code: -32700, message: 'Parse error' }
            });
            return;
        }

        const { id, method, params } = message;

        // Notifications
        if (method === 'notifications/initialized') {
            return;
        }

        if (method === 'ping') {
            sendJsonRpc({ jsonrpc: '2.0', id, result: {} });
            return;
        }

        if (method === 'initialize') {
            handleInitialize(id, params);
            return;
        }

        if (method === 'tools/list') {
            handleToolsList(id);
            return;
        }

        if (method === 'tools/call') {
            await handleToolCall(id, params);
            return;
        }

        // Method not found
        sendJsonRpc({
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method not found: ${method}` }
        });
    });

    process.on('SIGINT', () => process.exit(0));
    process.on('SIGTERM', () => process.exit(0));
}

main();
