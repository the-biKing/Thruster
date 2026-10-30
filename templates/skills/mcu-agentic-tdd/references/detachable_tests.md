# Detachable Testing Pattern for Embedded Microcontrollers

Embedded devices operate under strict memory, flash, and real-time timing constraints. Testing frameworks designed for PCs (like GoogleTest or Catch2) often require heavy C++ runtimes or OS support that cannot fit onto microcontrollers like ATmega328P, ESP32, or RP2040.

Thruster solves this with **Preprocessor-Guarded Detachable Testing**.

## How Detachable Testing Works

All test definitions, assertion checks, and serial test prints are isolated inside `#ifdef UNIT_TEST_MODE` blocks:

```cpp
#ifdef UNIT_TEST_MODE
void run_tests() {
    Serial.println(F("=== UNIT TESTS START ==="));
    bool ok1 = (clamp_and_scale(500, 1000, 4000, 255) == 0);
    Serial.println(ok1 ? F("[PASS] Below min clamps to 0") : F("[FAIL] Below min clamps to 0"));
    Serial.println(F("=== UNIT TESTS END ==="));
}
#endif
```

## Two Modes of Operation

### 1. Test Mode (Autonomous Agent Verification)
When Thruster MCP calls `compile_sketch` with `test_mode: true`, it automatically passes:
```bash
--build-property "compiler.cpp.extra_flags=-DUNIT_TEST_MODE=1 -DTHRUSTER_TEST_MODE=1"
```
*(Using `compiler.cpp.extra_flags` instead of `build.extra_flags` prevents accidental clobbering of core platform flags on ESP32, RP2040, and STM32).*

The compiler includes the test routines. Upon upload:
1. The MCU boots into `setup()`.
2. It waits for the `START_TEST` serial handshake from Thruster MCP (eliminating boot-vs-monitor race conditions).
3. It prints `[PASS]` or `[FAIL]` tokens over Serial.
4. It calls `Serial.flush()` and halts in `while (true) { delay(100); }` so real actuators and production `loop()` code never execute during testing.

### 2. Production Release Deploy
When compiling without `test_mode` (the default for normal builds):
- The macro `UNIT_TEST_MODE` is undefined.
- The C++ preprocessor completely skips the test block.
- Dead-code elimination strips any unused test helper functions.
- The final binary contains **0 bytes of test strings, 0 bytes of RAM overhead, and 0 execution latency**.

## Memory Impact Comparison

| Component | Test Mode (`UNIT_TEST_MODE=1`) | Production Release Mode |
| :--- | :--- | :--- |
| Test Strings (`"[PASS]..."`) | Stored in Flash / PROGMEM | **0 bytes (completely removed)** |
| Test Helper Functions | Compiled in Flash | **0 bytes (stripped by preprocessor)** |
| Serial Test Overhead | Transmitted once during test | **0 bytes / 0 cycles** |
| Hardware Actuator Fallthrough | Prevented via idle halt loop | **Normal execution in `loop()`** |
