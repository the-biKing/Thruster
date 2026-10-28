# 🚀 Thruster

**Thruster** is a lightweight, zero-overhead extension for **Antigravity IDE** and **VS Code** that brings a seamless **Python-like one-click execution experience** to Arduino and embedded microcontroller development across **macOS, Windows, and Linux**.

One click to compile, flash, and open the interactive serial monitor — with automated core downloads and a smart library auto-resolver.

---

## ⚡ Highlights & Key Features

* 💻 **Cross-Platform Support:** Fully compatible with **macOS** (Apple Silicon M1/M2/M3/M4 & Intel), **Windows 10/11**, and **Linux**.
* 🎯 **Broad Multi-MCU Support:** Works out of the box with ESP32, ESP8266, Arduino Uno/Nano/Mega/Due, Raspberry Pi Pico (RP2040 / RP2350), STM32, and any custom board.
* 📋 **Extension Readiness Checklist:** Interactive settings page with live health checks ensuring your `arduino-cli` binary is ready to go.
* ⚡ **One-Click `arduino-cli` Setup:** Automatic system detection or single-click automated download & installation of the official `arduino-cli` binary.
* 🧠 **Smart Library Auto-Resolver:** Automatically catches missing `#include <Library.h>` headers during compilation, searches the official Arduino registry, installs missing libraries, and recompiles.
* 🚀 **Editor Toolbar Controls:** Python-style run buttons in the top-right corner of any `.ino` sketch: **Compile**, **Flash (Upload)**, **Flash & Monitor**, and **Serial Monitor**.
* 🔌 **Auto USB Port Detection:** Dynamically resolves connected USB serial ports (`/dev/cu.*` on macOS, `COM*` on Windows, `/dev/ttyUSB*` on Linux).

---

## 🔌 Supported Microcontrollers (Multi-MCU)

Thruster features built-in presets and automatic toolchain downloads for popular microcontroller families:

| Architecture / Platform | Popular Supported Boards |
| :--- | :--- |
| **Espressif ESP32** | NodeMCU-32S, ESP32 Dev Module, ESP32-S2, ESP32-S3 (Native USB / USB OTG), ESP32-C3 SuperMini (RISC-V) |
| **Espressif ESP8266** | NodeMCU 1.0 (ESP-12E), Generic ESP8266 Module |
| **Classic Arduino (AVR)** | Arduino Uno R3 (ATmega328P), Arduino Nano, Arduino Mega / Mega 2560 |
| **Modern 32-bit Arduino** | Arduino Uno R4 Minima (Renesas RA4M1), Arduino Uno R4 WiFi, Arduino Uno WiFi Rev2 |
| **ARM Cortex-M3 (Atmel SAM)** | Arduino Due (Programming Port & Native USB Port) |
| **Raspberry Pi Silicon** | Raspberry Pi Pico (RP2040 Dual Cortex-M0+), Raspberry Pi Pico 2 (RP2350) |
| **STMicroelectronics STM32** | Generic STM32F1 Series (BluePill), STM32F4 |
| **Custom Boards** | Any installed core or custom FQBN via **🔍 Search All Installed Boards** or **Custom FQBN...** |

> **Automated Core Installation:** When you select a board whose toolchain isn't installed yet (e.g. ESP32, ESP8266, RP2040, or Renesas RA4M1), Thruster automatically updates the package index and installs the required core package via `arduino-cli`.

---

## 📋 Settings Page & Readiness Checklist

Thruster includes a dedicated **Control Center & Readiness Checklist** to guarantee your development environment is fully operational:

1. Open the Command Palette (`Ctrl+Shift+P` on Windows/Linux or `Cmd+Shift+P` on macOS).
2. Run **`Thruster: Open Settings & Readiness Checklist`** (or click the `$(gear)` icon in the editor title bar).
3. The checklist validates your environment:
   * **Step 1 — Valid `arduino-cli` binary:** Checks whether a working `arduino-cli` executable is located on system PATH, in standard IDE directories, or in `~/.thruster/bin/`.
   * **⚡ One-Click Auto-Install:** If `arduino-cli` is missing, click this button to automatically download and configure the official standalone binary for your OS and architecture.
   * **📂 Browse / Select Path:** Point Thruster to an existing binary already on your machine.
   * **⚙️ Live Configuration:** Adjust the Smart Library Resolver mode, default baud rate (115200, 9600, etc.), and switch hardware targets directly from the page.

---

## 🛠️ Toolbar & Status Bar Quick Controls

### 1. Editor Title Toolbar (Top-Right Action Buttons)
When opening any `.ino` sketch:

* **Before Initialization:**
  * Displays an **Initialize Project** `$(rocket)` button.
  * Guides you to select your target board, serial port, and baud rate, then configures `.vscode/arduino.json` and `.vscode/c_cpp_properties.json` for full C/C++ IntelliSense.

* **After Initialization:**
  * ⚡ **`Flash (Upload)`** `$(zap)`: One-click compile & upload to the connected board.
  * 🚀 **`Flash & Monitor`** `$(run-all)`: Compiles, flashes, and immediately launches the interactive Serial Monitor in the terminal.
  * ✔️ **`Compile / Verify`** `$(check)`: Fast verification and compilation without uploading.
  * 📡 **`Serial Monitor`** `$(radio-tower)`: Connects to the board's serial console (press `Ctrl + C` anytime to detach).
  * ⚙️ **`Settings`** `$(gear)`: Opens the Thruster Settings & Readiness Checklist.

### 2. Status Bar Controls (Bottom-Left)
* `$(circuit-board) Board Name`: Click to switch target microcontroller on the fly.
* `$(plug) Port: Auto (or /dev/cu... / COM...)`: Click to select or rescan serial ports.

---

## ⚙️ Configuration (`.vscode/arduino.json`)

When initialized in a project workspace, Thruster creates or updates `.vscode/arduino.json`:

```json
{
  "board": "esp32:esp32:nodemcu-32s",
  "boardName": "NodeMCU-32S (ESP32)",
  "port": "auto",
  "baudRate": 115200,
  "arduinoCliPath": ""
}
```

* `"arduinoCliPath"`: Optional path override. Leave empty `""` to use automatic detection or the one-click installed binary.
* `"port": "auto"`: Dynamically detects the connected USB microcontroller on each flash. You can also specify an exact port such as `"/dev/cu.usbserial-0001"` or `"COM3"`.

---

## 💬 Issues, Bug Reports & Community

Thruster is open-source! We welcome feedback, bug reports, and board support requests:

* **GitHub Repository:** [https://github.com/the-biKing/Thruster.git](https://github.com/the-biKing/Thruster.git)
* **Report an Issue:** [https://github.com/the-biKing/Thruster/issues](https://github.com/the-biKing/Thruster/issues)

If you encounter an issue or have an idea to make embedded programming smoother, please [file an issue on GitHub](https://github.com/the-biKing/Thruster/issues) and we will be happy to help.

---

## 📄 License

MIT License &copy; [the-biKing](https://github.com/the-biKing)
