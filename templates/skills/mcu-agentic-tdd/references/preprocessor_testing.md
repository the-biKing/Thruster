# Preprocessor-Guarded Testing for Embedded Systems

In embedded microcontroller development, unit testing on target hardware must satisfy two critical requirements:
1. **Zero Architecture Imposition**: Tests must integrate naturally into any codebase—procedural C, object-oriented C++, state machines, or legacy sketches—without requiring invasive refactoring or foreign test runtimes.
2. **Zero Production Overhead**: When the firmware is compiled for release, every test function, assertion check, and debug string must be completely removed from the binary.

---

## 1. Decision Framework: What to Test Autonomously

- **Test via MCP**: Mathematical transformations, sensor calibration curves, boundary clamps, state machines, packet encoders/decoders, circular buffers.
- **Hand Off to Human**: Visual LED patterns, PWM dimming, OLED screen layouts, buzzer frequencies, direct pin toggling (`digitalWrite`), and physical wiring.

---

## 2. Decouple Math & Logic from Direct Hardware I/O

Structure core logic so functions accept parameters and return computed values, rather than reading or writing hardware pins directly inside the calculation:

### Pattern A: Generic Math / Clamping Logic
```cpp
int clamp_and_scale(int raw, int min_in, int max_in, int out_max) {
    if (raw <= min_in) return 0;
    if (raw >= max_in) return out_max;
    return (int)((long)(raw - min_in) * out_max / (max_in - min_in));
}
```

### Pattern B: Discrete State / Packet Decoder
```cpp
enum SystemState { STATE_IDLE = 0, STATE_ACTIVE = 1, STATE_ERROR = 2 };

bool parse_command_packet(uint8_t byte, SystemState* state) {
    if (!state) return false;
    if (byte == 0xA5) { *state = STATE_ACTIVE; return true; }
    if (byte == 0x5A) { *state = STATE_IDLE; return true; }
    if (byte == 0xFF) { *state = STATE_ERROR; return true; }
    return false;
}
```

---

## 3. Direct Assertions in `#ifdef UNIT_TEST_MODE`

Wrap assertions inside `#ifdef UNIT_TEST_MODE`:

```cpp
#ifdef UNIT_TEST_MODE
#include <Arduino.h>

void run_unit_tests(void) {
    Serial.println(F("=== UNIT TESTS START ==="));

    bool pass1 = (clamp_and_scale(500, 1000, 4000, 255) == 0);
    bool pass2 = (clamp_and_scale(4500, 1000, 4000, 255) == 255);
    bool pass3 = (clamp_and_scale(2500, 1000, 4000, 255) == 127);

    Serial.println(pass1 ? F("[PASS] Below min clamps to 0") : F("[FAIL] Below min clamps to 0"));
    Serial.println(pass2 ? F("[PASS] Above max clamps to out_max") : F("[FAIL] Above max clamps to out_max"));
    Serial.println(pass3 ? F("[PASS] Midpoint scales correctly") : F("[FAIL] Midpoint scales correctly"));

    Serial.println(F("=== UNIT TESTS END ==="));
}
#endif
```

---

## 4. Lifecycle Integration & Fallthrough Prevention

In your main sketch's `setup()`:

```cpp
void setup() {
    Serial.begin(115200);

#ifdef UNIT_TEST_MODE
    // Wait up to 3s for Serial handshake before running tests
    unsigned long start = millis();
    while (millis() - start < 3000) {
        if (Serial.available()) {
            String s = Serial.readStringUntil('\n');
            s.trim();
            if (s == "START_TEST" || s == "CMD:TEST:ALL") break;
        }
        delay(10);
    }

    run_unit_tests();

    // Flush serial and halt in test mode
    Serial.flush();
    while (true) {
        delay(100); // Never fall through to production peripherals or loop() during tests
    }
#endif

    // Production peripheral initialization runs only in production mode
    Serial.println(F("Firmware ready."));
}

void loop() {
    // Normal production loop
}
```

---

## 5. Zero Cost in Production

When building for normal execution or production release:
- `UNIT_TEST_MODE` is undefined.
- The preprocessor strips `run_unit_tests()` and all test strings.
- **Zero bytes** of Flash and RAM are consumed.
