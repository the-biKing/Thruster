# Detachable Testing Pattern for Embedded Microcontrollers

Embedded devices operate under strict memory, flash, and real-time timing constraints. Testing frameworks designed for PCs (like GoogleTest or Catch2) often require heavy C++ runtimes or OS support that cannot fit onto microcontrollers like ATmega328P, ESP32, or RP2040.

Thruster solves this with **Preprocessor-Guarded Detachable Testing**.

## How Detachable Testing Works

All test definitions, assertion checks, and serial test prints are isolated inside `#ifdef UNIT_TEST_MODE` blocks:

```cpp
#ifdef UNIT_TEST_MODE
void run_tests() {
    Serial.println("=== UNIT TESTS START ===");
    bool ok1 = (sensor_scale_value(512) == 50);
    Serial.println(ok1 ? "[PASS] Half scale" : "[FAIL] Half scale");
    Serial.println("=== UNIT TESTS END ===");
}
#endif
```

## Two Modes of Operation

### 1. Test Mode (Autonomous Agent Verification)
When Thruster MCP calls `compile_sketch` with `test_mode: true`, it automatically passes:
```bash
--build-property "build.extra_flags=-DUNIT_TEST_MODE=1"
```
The compiler includes the test routines. Upon upload, the MCU executes the tests in `setup()` and prints `[PASS]` or `[FAIL]` tokens over Serial for the AI agent to verify.

### 2. Production Release Deploy
When compiling without `test_mode` (the default for normal builds):
- The macro `UNIT_TEST_MODE` is undefined.
- The C++ preprocessor completely skips the test block.
- Dead-code elimination strips any unused test helper functions.
- The final binary contains **0 bytes of test strings, 0 bytes of RAM overhead, and 0 execution latency**.

## Memory Impact Comparison

| Component | Test Mode (`UNIT_TEST_MODE=1`) | Production Release Mode |
| :--- | :--- | :--- |
| Test Strings (`"[PASS]..."`) | Stored in Flash | **0 bytes (completely removed)** |
| Test Helper Functions | Compiled in Flash | **0 bytes (stripped by preprocessor)** |
| Serial Test Overhead | Transmitted once at boot | **0 bytes / 0 cycles** |
