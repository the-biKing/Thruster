/**
 * Thruster Testable Firmware Template
 * ---------------------------------------------------------------------
 * Demonstrates preprocessor-guarded unit testing for microcontrollers.
 *
 * DEVELOPMENT & TESTING:
 *   When compiled with Thruster MCP (test_mode: true), -DUNIT_TEST_MODE=1
 *   is passed automatically to activate unit test assertions in setup().
 *
 * PRODUCTION RELEASE:
 *   Standard builds omit UNIT_TEST_MODE. All test functions, assertion
 *   checks, and strings are stripped by the preprocessor—0 bytes of overhead!
 */

#include <Arduino.h>

// =====================================================================
// 1. Core Functions & Algorithms (Pure logic decoupled from I/O)
// =====================================================================

// Generic Math / Boundary Logic (e.g. sensor calibration, scaling)
int clamp_and_scale(int raw, int min_in, int max_in, int out_max) {
    if (raw <= min_in) return 0;
    if (raw >= max_in) return out_max;
    return (int)((long)(raw - min_in) * out_max / (max_in - min_in));
}

// State / Packet Decoder Logic (e.g. protocol parser, state machine)
enum SystemState { STATE_IDLE = 0, STATE_ACTIVE = 1, STATE_ERROR = 2 };

bool parse_command_packet(uint8_t byte, SystemState* state) {
    if (!state) return false;
    if (byte == 0xA5) { *state = STATE_ACTIVE; return true; }
    if (byte == 0x5A) { *state = STATE_IDLE; return true; }
    if (byte == 0xFF) { *state = STATE_ERROR; return true; }
    return false; // Unknown or invalid packet byte
}

// =====================================================================
// 2. Preprocessor-Guarded Unit Tests (Only compiled in UNIT_TEST_MODE)
// =====================================================================

#ifdef UNIT_TEST_MODE
void wait_for_test_trigger() {
    // Wait up to 3 seconds for Serial connection or START_TEST trigger
    unsigned long start = millis();
    while (millis() - start < 3000) {
        if (Serial.available()) {
            String s = Serial.readStringUntil('\n');
            s.trim();
            if (s == "START_TEST" || s == "CMD:TEST:ALL") {
                break;
            }
        }
        delay(10);
    }
}

void run_unit_tests() {
    Serial.println(F("=== THRUSTER UNIT TESTS START ==="));

    // Test 1: Math / Boundary logic
    bool pass1 = (clamp_and_scale(500, 1000, 4000, 255) == 0);
    bool pass2 = (clamp_and_scale(4500, 1000, 4000, 255) == 255);
    bool pass3 = (clamp_and_scale(2500, 1000, 4000, 255) == 127);

    // Test 2: State / Packet decoder logic
    SystemState testState = STATE_IDLE;
    bool pass4 = parse_command_packet(0xA5, &testState) && (testState == STATE_ACTIVE);
    bool pass5 = parse_command_packet(0x5A, &testState) && (testState == STATE_IDLE);
    bool pass6 = !parse_command_packet(0x12, &testState); // Invalid byte rejected

    Serial.println(pass1 ? F("[PASS] Below min clamps to 0") : F("[FAIL] Below min clamps to 0"));
    Serial.println(pass2 ? F("[PASS] Above max clamps to out_max") : F("[FAIL] Above max clamps to out_max"));
    Serial.println(pass3 ? F("[PASS] Midpoint scales correctly") : F("[FAIL] Midpoint scales correctly"));
    Serial.println(pass4 ? F("[PASS] 0xA5 transitions to ACTIVE") : F("[FAIL] 0xA5 transitions to ACTIVE"));
    Serial.println(pass5 ? F("[PASS] 0x5A transitions to IDLE") : F("[FAIL] 0x5A transitions to IDLE"));
    Serial.println(pass6 ? F("[PASS] Invalid byte returns false") : F("[FAIL] Invalid byte returns false"));

    Serial.println(F("=== THRUSTER UNIT TESTS END ==="));
}
#endif

// =====================================================================
// 3. Arduino Lifecycle (setup & loop)
// =====================================================================

void setup() {
    Serial.begin(115200);

#ifdef UNIT_TEST_MODE
    wait_for_test_trigger();
    run_unit_tests();
    Serial.flush();
    while (true) {
        delay(100); // Halt in test mode: never fall through to production peripherals or loop()
    }
#endif

    // Production peripheral initialization runs below:
    Serial.println(F("Firmware ready."));
}

void loop() {
    // Normal production code runs here
}
