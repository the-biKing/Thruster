# 🚀 Thruster

**Thruster** is a lightweight, zero-overhead extension for **Antigravity IDE** and **VS Code** that brings a seamless **Python-like one-click execution experience** to Arduino and ESP32 microcontroller development.

> **Current Focus:** NodeMCU ESP32-S (`esp32:esp32:nodemcu-32s`), with an extensible architecture designed to support all microcontrollers compatible with Arduino IDE (ESP32-S3, ESP32-C3, Arduino Uno, Nano, RP2040, etc.).

---

## ⚡ Features

### 1. Editor Title Toolbar (Top-Right Action Buttons)
Whenever you open any `.ino` sketch file:

* **Before Initialization:**
  * Displays an **Initialize Project** `$(gear)` icon button in the top-right toolbar (same location as Python's run button).
  * Prompts you to select your target board, upload port, and baud rate.
  * Automatically sets up `.vscode/arduino.json` and configures `.vscode/c_cpp_properties.json` for full C++ IntelliSense.

* **After Initialization:**
  * The `Init` button is dynamically replaced by 4 dedicated action buttons:
    * ⚡ **`Flash (Upload)`** `$(zap)`: One-click compile & upload to the board.
    * 🚀 **`Flash & Monitor`** `$(run-all)`: Compiles, flashes, and immediately launches the interactive Serial Monitor in the terminal.
    * ✔️ **`Compile / Verify`** `$(check)`: Fast syntax check & compilation without uploading.
    * 📡 **`Serial Monitor`** `$(radio-tower)`: Connects to the board's serial output (default 115200 baud).

### 2. Status Bar Quick Controls
Located at the bottom-left of the Antigravity window:
* `$(circuit-board) ESP32: NodeMCU-32S` &rarr; Click to switch target board on the fly.
* `$(plug) Port: COM3 (or Auto)` &rarr; Click to switch or scan connected serial ports.

### 3. Integrated Terminal Experience
All operations stream inside a dedicated `Thruster ESP32` terminal:
* Real-time build progress and flash percentages.
* Interactive serial monitor (press `Ctrl + C` anytime to detach).

---

## 🛠️ Managing Thruster in Antigravity IDE

### 1. Temporarily Disabling / Enabling the Extension
Because Thruster is installed with standard extension metadata:
1. Open the **Extensions panel** (`Ctrl + Shift + X`).
2. Search for `@installed Thruster`.
3. Click the **Disable** button:
   - **Disable (Workspace):** Disables Thruster only for your current project.
   - **Disable:** Disables Thruster globally across all workspaces.
4. To re-enable, simply click **Enable** in the same view.

### 2. Live Updating During Development
Thruster is installed using a **Directory Junction** linking directly from:
`C:\Users\joshh\.antigravity-ide\extensions\antigravity.thruster-0.1.0`
&darr;
`G:\code\Thruster`

**This means you do not need to reinstall after making code changes:**
1. Edit any file in `G:\code\Thruster` (e.g. `extension.js` or `package.json`).
2. Save the file.
3. In Antigravity IDE, press `Ctrl + Shift + P` &rarr; type **`Developer: Reload Window`** &rarr; hit `Enter`.
4. Your new code is running instantly!

### 3. Re-installing or Linking Manually
If you ever move folders or want to relink:
```powershell
# In G:\code\Thruster:
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

### 3. Automatic `arduino-cli` Detection & One-Click Setup
Thruster automatically detects `arduino-cli` on your system across:
* System `PATH`
* Official Arduino IDE 2.x standard installation folders
* User local directories (`~/.thruster/bin/arduino-cli`)

If `arduino-cli` is not found, Thruster presents an interactive prompt with:
* ⚡ **One-Click Auto-Install:** Automatically downloads, extracts, and configures the latest official standalone `arduino-cli` binary into `~/.thruster/bin/` with zero manual configuration.
* 📂 **Browse / Point to Path:** Choose any custom `arduino-cli` executable on your system.

You can also run **`Thruster: Setup / Locate arduino-cli`** from the Command Palette (`Ctrl + Shift + P`) at any time.

---

## ⚙️ Configuration File (`.vscode/arduino.json`)

When initialized in a project, Thruster creates `.vscode/arduino.json`:

```json
{
  "board": "esp32:esp32:nodemcu-32s",
  "boardName": "NodeMCU-32S (ESP32)",
  "port": "auto",
  "baudRate": 115200,
  "arduinoCliPath": ""
}
```

* `"arduinoCliPath"`: Optional path override. Leave empty `""` to use auto-detection or the one-click installed binary.
* `"port": "auto"`: Dynamically finds the USB serial port on each flash.
* You can also specify an exact port like `"COM3"`.
