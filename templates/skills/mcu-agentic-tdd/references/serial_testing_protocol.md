# Serial Testing Protocol & Thruster MCP Reference

Thruster enables AI agents to autonomously drive the embedded MCU development loop:
`Edit Code` -> `Compile` -> `Flash` -> `Test via Serial` -> `Verify / Refactor`.

## Serial Protocol Specification

When `THRUSTER_TEST_MODE` is enabled, the firmware listens on the configured Serial port (`115200` bps by default) for newline-terminated (`\n`) ASCII command packets.

### 1. Inbound Commands (Sent from Agent to MCU)

| Command | Arguments | Description | Example |
| :--- | :--- | :--- | :--- |
| `CMD:PING` | None | Liveness check; MCU responds immediately with `[THRUSTER:PONG]` | `CMD:PING\n` |
| `CMD:TEST:ALL` | None | Runs every test registered with `THRUSTER_REGISTER_TEST` sequentially | `CMD:TEST:ALL\n` |
| `CMD:TEST:<NAME>` | Test Name | Runs only the specified test case | `CMD:TEST:button_press_toggles\n` |
| `CMD:EVENT:<TYPE>:<DATA>` | Type (int), Data (int32) | Injects synthetic event into `on_thruster_event_command(type, data)` | `CMD:EVENT:2:0\n` |

### 2. Outbound Markers (Emitted from MCU to Agent)

The firmware prints structured tokens that the Thruster MCP tool `run_serial_test` automatically parses:

- `[TEST:START] <test_name>`: Test execution started.
- `[TEST:PASS] <test_name>`: Test passed all assertions.
- `[TEST:FAIL] <description> | Expected: X Actual: Y (<file>:<line>)`: Assertion failed.
- `[TEST:SUMMARY] total=N, passed=P, failed=F`: Summary count of all executed tests.
- `[TEST:EVENT_INJECTED] type=X data=Y`: Acknowledgment of synthetic event reception.

---

## Thruster MCP Tool Reference

AI agents interact with the microcontroller through the following MCP tools:

### `compile_sketch`
- **Parameters**: `sketch_path` (string, opt), `fqbn` (string, opt), `test_mode` (bool, opt)
- **Output**:
  - `success`: `true` or `false`
  - `memory`: Flash & RAM bytes used, max, percent, and free
  - `errors`: Array of parsed compiler errors with line and column numbers
  - `raw_output`: Full GCC/arduino-cli compiler logs

### `flash_sketch`
- **Parameters**: `sketch_path` (string, opt), `port` (string, opt), `fqbn` (string, opt)
- **Output**:
  - `success`: `true` or `false`
  - `port`: Port used for upload
  - `raw_output`: Output from upload runner

### `run_serial_test`
- **Parameters**:
  - `command`: Command to send (e.g. `"CMD:TEST:ALL"` or `"CMD:EVENT:2:0"`)
  - `expected_pattern`: Optional regex pattern to wait for (default: `\[TEST:SUMMARY\]`)
  - `timeout_ms`: Max milliseconds to wait (default: 6000)
- **Output**:
  - `status`: `"PASS"`, `"FAIL"`, or `"TIMEOUT"`
  - `summary`: `{ total: 4, passed: 4, failed: 0 }`
  - `passed_tests`: List of test names that passed
  - `failed_tests`: List of failure details and lines
  - `logs`: Complete serial capture

### `read_serial` & `write_serial`
- Low-level tools for inspecting streaming debug logs or sending raw strings to the MCU.
