# Serial Testing Protocol & Thruster MCP Reference

Thruster enables AI agents to autonomously drive the embedded MCU development loop:
`Edit Code` -> `Compile with test_mode` -> `Flash` -> `Test via Serial` -> `Verify / Refactor`.

## Serial Test Output Specification

When tests run, they output concise, machine-parseable tokens over Serial that the Thruster MCP server automatically captures and summarizes.

### Standard Test Tokens

- `[PASS] <test_name>` or `[TEST:PASS] <test_name>`: Assertion or test passed.
- `[FAIL] <test_name>` or `[TEST:FAIL] <test_name>`: Assertion or test failed.
- `[SUMMARY] passed=X failed=Y` or `[TEST:SUMMARY] total=N, passed=P, failed=F`: (Optional) Summary counts.

Example output:
```text
=== UNIT TESTS START ===
[PASS] Below min clamps to 0
[PASS] Above max clamps to out_max
[PASS] Midpoint scales correctly
[PASS] 0xA5 transitions to ACTIVE
[PASS] 0x5A transitions to IDLE
[PASS] Invalid byte returns false
=== UNIT TESTS END ===
```

Thruster MCP automatically parses these tokens and returns structured JSON:
```json
{
  "status": "PASS",
  "summary": { "total": 6, "passed": 6, "failed": 0 },
  "passed_tests": [
    "Below min clamps to 0",
    "Above max clamps to out_max",
    "Midpoint scales correctly",
    "0xA5 transitions to ACTIVE",
    "0x5A transitions to IDLE",
    "Invalid byte returns false"
  ],
  "failed_tests": []
}
```

---

## Handshake Synchronization & Hardware Flushing

1. **Host Handshake Ping:**
   When `run_serial_test` connects to the serial port, it automatically sends `START_TEST\n` after a brief settling delay (600ms).
2. **MCU Synchronization:**
   In `#ifdef UNIT_TEST_MODE`, the sketch waits for this handshake (or falls back after 3000ms), ensuring that serial test outputs are never printed before the host's monitor has established a connection.
3. **Hardware FIFO Flushing:**
   After printing test tokens, the MCU executes `Serial.flush()` to ensure all bytes leave the hardware UART TX buffer before halting in an idle loop (`while (true) { delay(100); }`).

---

## Thruster MCP Tool Reference

### `compile_sketch`
- **Parameters**: `sketch_path` (string, opt), `fqbn` (string, opt), `test_mode` (bool, opt)
- **Behavior**: Compiles the sketch. When `test_mode: true` is passed, passes `--build-property "compiler.cpp.extra_flags=-DUNIT_TEST_MODE=1 -DTHRUSTER_TEST_MODE=1"` without modifying platform-level `build.extra_flags`.
- **Output**:
  - `success`: `true` or `false`
  - `memory`: Flash & RAM bytes used, max, percent, and free
  - `errors`: Array of parsed compiler errors with line and column numbers
  - `raw_output`: Full compiler logs

### `flash_sketch`
- **Parameters**: `sketch_path` (string, opt), `port` (string, opt), `fqbn` (string, opt)
- **Output**:
  - `success`: `true` or `false`
  - `port`: Port used for upload
  - `raw_output`: Upload log

### `run_serial_test`
- **Parameters**:
  - `command`: (Optional) command to send over Serial to trigger tests (default: `'START_TEST'`). Pass empty string `""` to listen passively.
  - `expected_pattern`: (Optional) regex pattern to wait for (default: `\[(?:TEST:)?(?:SUMMARY|PASS|FAIL)\]`).
  - `timeout_ms`: Max milliseconds to wait (default: 6000ms).
- **Output**:
  - `status`: `"PASS"`, `"FAIL"`, or `"TIMEOUT"`
  - `summary`: `{ total: N, passed: P, failed: F }`
  - `passed_tests`: List of test names that passed
  - `failed_tests`: List of failure details
  - `logs`: Complete serial capture

### `read_serial` & `write_serial`
- Low-level tools for inspecting streaming debug logs or sending raw strings to the MCU.
