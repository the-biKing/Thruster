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
=== MOTOR TESTS START ===
[PASS] Low cutoff below 1500
[PASS] Max PWM at 4095
[PASS] Threshold boundary 1500
=== MOTOR TESTS END ===
```

Thruster MCP automatically parses these tokens and returns structured JSON:
```json
{
  "status": "PASS",
  "summary": { "total": 3, "passed": 3, "failed": 0 },
  "passed_tests": ["Low cutoff below 1500", "Max PWM at 4095", "Threshold boundary 1500"],
  "failed_tests": []
}
```

---

## Thruster MCP Tool Reference

AI agents interact with the microcontroller through the following MCP tools:

### `compile_sketch`
- **Parameters**: `sketch_path` (string, opt), `fqbn` (string, opt), `test_mode` (bool, opt)
- **Behavior**: Compiles the sketch. When `test_mode: true` is passed, adds `-DUNIT_TEST_MODE=1` to activate `#ifdef UNIT_TEST_MODE` blocks.
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
  - `command`: (Optional) command to send over Serial. If omitted, listens directly for tests running upon boot in `setup()`.
  - `expected_pattern`: (Optional) regex pattern to wait for (default: `\[(?:TEST:)?(?:SUMMARY|PASS|FAIL)\]`).
  - `timeout_ms`: Max milliseconds to wait (default: 6000ms).
- **Output**:
  - `status`: `"PASS"`, `"FAIL"`, or `"TIMEOUT"`
  - `summary`: `{ total: 3, passed: 3, failed: 0 }`
  - `passed_tests`: List of test names that passed
  - `failed_tests`: List of failure details
  - `logs`: Complete serial capture

### `read_serial` & `write_serial`
- Low-level tools for inspecting streaming debug logs or sending raw strings to the MCU.
