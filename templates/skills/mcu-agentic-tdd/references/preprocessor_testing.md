# Preprocessor-Guarded Testing for Embedded Systems

In embedded microcontroller development, unit testing on target hardware must satisfy two critical requirements:
1. **Zero Architecture Imposition**: Tests must integrate naturally into any codebase—procedural C, object-oriented C++, state machines, or legacy sketches—without requiring invasive refactoring.
2. **Zero Production Overhead**: When the firmware is compiled for release, every test function, assertion check, and debug string must be completely removed from the binary.

## The Preprocessor Guarding Pattern

The simplest, cleanest, and most effective way to test MCU code is **Preprocessor Guarding** using `#ifdef UNIT_TEST_MODE`.

### 1. Separate Math & Logic from Direct Hardware IO
Where possible, structure functions so the computational core takes inputs as parameters and returns results, rather than calling `analogRead()` or `digitalWrite()` directly inside the math:

```cpp
// motor_control.cpp
#include "motor_control.h"

int calculate_pwm_from_voltage(int raw_adc) {
    if (raw_adc < 1500) return 0; // Low voltage cutoff
    if (raw_adc > 4095) raw_adc = 4095;
    return (raw_adc - 1500) * 255 / (4095 - 1500);
}
```

### 2. Direct Functional Assertions in `#ifdef UNIT_TEST_MODE`
Place test assertions directly in the same file or a test section, wrapped by `#ifdef UNIT_TEST_MODE`:

```cpp
#ifdef UNIT_TEST_MODE
#include <Arduino.h>

void run_motor_tests(void) {
    Serial.println("=== MOTOR TESTS START ===");

    bool pass1 = (calculate_pwm_from_voltage(1000) == 0);
    bool pass2 = (calculate_pwm_from_voltage(4095) == 255);
    bool pass3 = (calculate_pwm_from_voltage(1500) == 0);

    Serial.println(pass1 ? "[PASS] Low cutoff below 1500" : "[FAIL] Low cutoff below 1500");
    Serial.println(pass2 ? "[PASS] Max PWM at 4095" : "[FAIL] Max PWM at 4095");
    Serial.println(pass3 ? "[PASS] Threshold boundary 1500" : "[FAIL] Threshold boundary 1500");

    Serial.println("=== MOTOR TESTS END ===");
}
#endif
```

### 3. Calling Tests in `setup()`
In your main sketch:

```cpp
void setup() {
    Serial.begin(115200);

#ifdef UNIT_TEST_MODE
    run_motor_tests();
#endif

    // Normal hardware initialization continues here...
}

void loop() {
    // Normal production loop
}
```

### 4. Zero Cost in Production
When building for normal execution or release:
- `UNIT_TEST_MODE` is not defined.
- The preprocessor strips `run_motor_tests()` and all test strings.
- **Zero bytes** of Flash and RAM are consumed.
