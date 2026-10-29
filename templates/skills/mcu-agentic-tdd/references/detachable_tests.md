# Detachable Testing Pattern for Embedded Firmware

Embedded devices operate under strict memory, flash, and timing constraints. Test harnesses that remain in production firmware consume precious kilobytes of flash, waste RAM on assertion strings, and may introduce latency or security vulnerabilities.

Thruster solves this with the **Detachable Testing Pattern**.

## How Detachable Testing Works

All test definitions, assertion macros, test runners, and serial command listeners are isolated inside `tests.h` guarded by `THRUSTER_TEST_MODE`:

```cpp
#if defined(THRUSTER_TEST_MODE)
    // Full Test Runner, Assertion Engine, and Serial Command Listener
    #define TEST_ASSERT_TRUE(cond, desc) ...
    #define thruster_test_init()         register_project_tests()
    #define thruster_test_poll_serial()  ThrusterTestHarness::poll_serial()
#else
    // Production Release: Zero Flash / RAM / CPU Overhead
    #define TEST_ASSERT_TRUE(cond, desc) ((void)0)
    #define thruster_test_init()         ((void)0)
    #define thruster_test_poll_serial()  ((void)0)
#endif
```

## Two Modes of Operation

### 1. Development & Automated Agent Testing
In your sketch, keep `#define THRUSTER_TEST_MODE 1` at the top:

```cpp
#define THRUSTER_TEST_MODE 1
#include "tests.h"

void setup() {
    Serial.begin(115200);
    thruster_test_init();
}

void loop() {
    thruster_test_poll_serial();
}
```

The Thruster MCP server or developer can now execute `run_serial_test`, send commands over Serial, and receive assertion outcomes.

### 2. Production Release Deploy
When your firmware is verified and ready to ship to production:
1. Comment out `#define THRUSTER_TEST_MODE 1` (or pass nothing to the compiler).
2. The C++ preprocessor replaces all test calls with `((void)0)` no-ops, and dead-code elimination strips all test functions and assertion strings from the final binary.
3. Alternatively, simply delete or exclude `tests.h` and the test blocks for 100% clean deployment.

## Memory Impact Comparison

| Component | Development Mode (`THRUSTER_TEST_MODE=1`) | Production Release Mode |
| :--- | :--- | :--- |
| Test Strings (`[TEST:FAIL]...`) | Stored in Flash (`F()`) | **0 bytes** |
| Test Function Pointers | Stored in RAM/Flash | **0 bytes** |
| Serial Buffer (`serial_buf`) | ~96 bytes RAM | **0 bytes** |
| Execution Latency in `loop()` | Minimal (~1µs per cycle) | **0 ns (completely eliminated)** |
