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
// 1. Core Functions & Algorithms
// =====================================================================

int calculate_pwm_from_voltage(int raw_adc) {
    if (raw_adc < 1500) return 0; // Low voltage cutoff
    if (raw_adc > 4095) raw_adc = 4095;
    return (raw_adc - 1500) * 255 / (4095 - 1500);
}

bool is_sensor_in_alarm_state(float temperature_celsius, float threshold) {
    return temperature_celsius >= threshold;
}

// =====================================================================
// 2. Preprocessor-Guarded Unit Tests (Only compiled in UNIT_TEST_MODE)
// =====================================================================

#ifdef UNIT_TEST_MODE
void run_unit_tests() {
    Serial.println(F("=== THRUSTER UNIT TESTS START ==="));

    bool pass1 = (calculate_pwm_from_voltage(1000) == 0);
    bool pass2 = (calculate_pwm_from_voltage(4095) == 255);
    bool pass3 = (calculate_pwm_from_voltage(1500) == 0);
    bool pass4 = is_sensor_in_alarm_state(75.5f, 70.0f);
    bool pass5 = !is_sensor_in_alarm_state(65.0f, 70.0f);

    Serial.println(pass1 ? F("[PASS] Low cutoff below 1500") : F("[FAIL] Low cutoff below 1500"));
    Serial.println(pass2 ? F("[PASS] Max PWM at 4095") : F("[FAIL] Max PWM at 4095"));
    Serial.println(pass3 ? F("[PASS] Boundary cutoff at 1500") : F("[FAIL] Boundary cutoff at 1500"));
    Serial.println(pass4 ? F("[PASS] Alarm triggers when temp >= threshold") : F("[FAIL] Alarm triggers when temp >= threshold"));
    Serial.println(pass5 ? F("[PASS] No alarm when temp < threshold") : F("[FAIL] No alarm when temp < threshold"));

    Serial.println(F("=== THRUSTER UNIT TESTS END ==="));
}
#endif

// =====================================================================
// 3. Arduino Lifecycle (setup & loop)
// =====================================================================

void setup() {
    Serial.begin(115200);

#ifdef UNIT_TEST_MODE
    run_unit_tests();
#endif

    Serial.println(F("Firmware ready."));
}

void loop() {
    // Normal production code runs here
}
