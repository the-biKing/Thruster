/**
 * Thruster Detachable Test Harness (tests.h)
 * -------------------------------------------------------------
 * Combines Event-Driven Architecture (EDA) and Test-Driven Design (TDD)
 * for Microcontroller (MCU) development.
 *
 * DETACHABLE ZERO-OVERHEAD DESIGN:
 * - In Development: Define THRUSTER_TEST_MODE (e.g. #define THRUSTER_TEST_MODE 1).
 *   The test runner listens over Serial and allows AI agents or developers
 *   to inject events and verify assertions automatically.
 * - In Production: Comment out or remove #define THRUSTER_TEST_MODE.
 *   All test assertions, strings, and runners compile away to empty no-ops ((void)0),
 *   leaving 0 bytes of flash and RAM overhead in the final release binary!
 */

#ifndef THRUSTER_TESTS_H
#define THRUSTER_TESTS_H

#if defined(THRUSTER_TEST_MODE)

#include <Arduino.h>

#ifdef __cplusplus
extern "C" {
#endif

// Counters
extern uint16_t _thruster_test_total;
extern uint16_t _thruster_test_passed;
extern uint16_t _thruster_test_failed;
extern bool _thruster_current_test_failed;

#ifdef __cplusplus
}
#endif

// =============================================================
// Test Assertion Macros (Only active in THRUSTER_TEST_MODE)
// =============================================================

#define TEST_ASSERT_TRUE(cond, desc) \
    do { \
        if (!(cond)) { \
            Serial.print(F("[TEST:FAIL] ")); \
            Serial.print(F(desc)); \
            Serial.print(F(" (")); \
            Serial.print(__FILE__); \
            Serial.print(F(":")); \
            Serial.print(__LINE__); \
            Serial.println(F(")")); \
            _thruster_current_test_failed = true; \
            return; \
        } \
    } while (0)

#define TEST_ASSERT_FALSE(cond, desc) \
    TEST_ASSERT_TRUE(!(cond), desc)

#define TEST_ASSERT_EQ(actual, expected, desc) \
    do { \
        if ((actual) != (expected)) { \
            Serial.print(F("[TEST:FAIL] ")); \
            Serial.print(F(desc)); \
            Serial.print(F(" | Expected: ")); \
            Serial.print(expected); \
            Serial.print(F(" Actual: ")); \
            Serial.print(actual); \
            Serial.print(F(" (")); \
            Serial.print(__FILE__); \
            Serial.print(F(":")); \
            Serial.print(__LINE__); \
            Serial.println(F(")")); \
            _thruster_current_test_failed = true; \
            return; \
        } \
    } while (0)

#define TEST_ASSERT_NE(actual, unexpected, desc) \
    do { \
        if ((actual) == (unexpected)) { \
            Serial.print(F("[TEST:FAIL] ")); \
            Serial.print(F(desc)); \
            Serial.print(F(" | Value should not equal: ")); \
            Serial.print(unexpected); \
            Serial.print(F(" (")); \
            Serial.print(__FILE__); \
            Serial.print(F(":")); \
            Serial.print(__LINE__); \
            Serial.println(F(")")); \
            _thruster_current_test_failed = true; \
            return; \
        } \
    } while (0)

#define TEST_ASSERT_STR_EQ(actual, expected, desc) \
    do { \
        if (String(actual) != String(expected)) { \
            Serial.print(F("[TEST:FAIL] ")); \
            Serial.print(F(desc)); \
            Serial.print(F(" | Expected: \"")); \
            Serial.print(expected); \
            Serial.print(F("\" Actual: \"")); \
            Serial.print(actual); \
            Serial.print(F("\" (")); \
            Serial.print(__FILE__); \
            Serial.print(F(":")); \
            Serial.print(__LINE__); \
            Serial.println(F(")")); \
            _thruster_current_test_failed = true; \
            return; \
        } \
    } while (0)

// =============================================================
// Test Registration & Execution Infrastructure
// =============================================================

typedef void (*ThrusterTestFunc)();

struct ThrusterTestCase {
    const char* name;
    ThrusterTestFunc func;
};

#define THRUSTER_MAX_TESTS 32

#ifdef __cplusplus

namespace ThrusterTestHarness {
    inline uint16_t test_count = 0;
    inline ThrusterTestCase tests[THRUSTER_MAX_TESTS];
    inline char serial_buf[96];
    inline uint8_t serial_idx = 0;

    inline void register_test(const char* name, ThrusterTestFunc func) {
        if (test_count < THRUSTER_MAX_TESTS) {
            tests[test_count].name = name;
            tests[test_count].func = func;
            test_count++;
        }
    }

    inline void run_test_by_index(uint16_t idx) {
        if (idx >= test_count) return;
        _thruster_test_total++;
        _thruster_current_test_failed = false;

        Serial.print(F("[TEST:START] "));
        Serial.println(tests[idx].name);

        tests[idx].func();

        if (!_thruster_current_test_failed) {
            _thruster_test_passed++;
            Serial.print(F("[TEST:PASS] "));
            Serial.println(tests[idx].name);
        } else {
            _thruster_test_failed++;
        }
    }

    inline void run_all_tests() {
        _thruster_test_total = 0;
        _thruster_test_passed = 0;
        _thruster_test_failed = 0;

        Serial.println(F("=== THRUSTER TEST RUNNER STARTED ==="));
        for (uint16_t i = 0; i < test_count; i++) {
            run_test_by_index(i);
        }
        Serial.print(F("[TEST:SUMMARY] total="));
        Serial.print(_thruster_test_total);
        Serial.print(F(", passed="));
        Serial.print(_thruster_test_passed);
        Serial.print(F(", failed="));
        Serial.println(_thruster_test_failed);
        Serial.println(F("=== THRUSTER TEST RUNNER FINISHED ==="));
    }

    // Weak hook for event injection by agent over Serial
    // User can implement `void on_thruster_event_command(int type, int32_t data)` in sketch
    __attribute__((weak)) void on_thruster_event_command(int type, int32_t data) {
        (void)type;
        (void)data;
    }

    inline void parse_command(const char* cmd) {
        if (strcmp(cmd, "CMD:PING") == 0) {
            Serial.println(F("[THRUSTER:PONG]"));
        } else if (strcmp(cmd, "CMD:TEST:ALL") == 0) {
            run_all_tests();
        } else if (strncmp(cmd, "CMD:TEST:", 9) == 0) {
            const char* targetName = cmd + 9;
            for (uint16_t i = 0; i < test_count; i++) {
                if (strcmp(tests[i].name, targetName) == 0) {
                    run_test_by_index(i);
                    return;
                }
            }
            Serial.print(F("[TEST:FAIL] Unknown test: "));
            Serial.println(targetName);
        } else if (strncmp(cmd, "CMD:EVENT:", 10) == 0) {
            // Format: CMD:EVENT:<type>:<data>
            char temp[64];
            strncpy(temp, cmd + 10, sizeof(temp) - 1);
            temp[sizeof(temp) - 1] = '\0';
            char* colon = strchr(temp, ':');
            int eventType = 0;
            int32_t eventData = 0;
            if (colon) {
                *colon = '\0';
                eventType = atoi(temp);
                eventData = atol(colon + 1);
            } else {
                eventType = atoi(temp);
            }
            Serial.print(F("[TEST:EVENT_INJECTED] type="));
            Serial.print(eventType);
            Serial.print(F(" data="));
            Serial.println(eventData);
            on_thruster_event_command(eventType, eventData);
        }
    }

    inline void poll_serial() {
        while (Serial.available() > 0) {
            char c = (char)Serial.read();
            if (c == '\r') continue;
            if (c == '\n') {
                serial_buf[serial_idx] = '\0';
                if (serial_idx > 0) {
                    parse_command(serial_buf);
                }
                serial_idx = 0;
            } else {
                if (serial_idx < sizeof(serial_buf) - 1) {
                    serial_buf[serial_idx++] = c;
                }
            }
        }
    }
}

// Global state definitions
uint16_t _thruster_test_total = 0;
uint16_t _thruster_test_passed = 0;
uint16_t _thruster_test_failed = 0;
bool _thruster_current_test_failed = false;

#define THRUSTER_REGISTER_TEST(name, func) \
    ThrusterTestHarness::register_test(name, func)

#define thruster_test_init() \
    do { \
        register_project_tests(); \
    } while(0)

#define thruster_test_poll_serial() \
    ThrusterTestHarness::poll_serial()

#define thruster_run_all_tests() \
    ThrusterTestHarness::run_all_tests()

#endif // __cplusplus

#else

// =============================================================
// PRODUCTION RELEASE MODE (THRUSTER_TEST_MODE is NOT defined)
// Compiles to 100% ZERO flash, RAM, and runtime overhead!
// =============================================================

#define TEST_ASSERT_TRUE(cond, desc)           ((void)0)
#define TEST_ASSERT_FALSE(cond, desc)          ((void)0)
#define TEST_ASSERT_EQ(actual, expected, desc) ((void)0)
#define TEST_ASSERT_NE(actual, unexp, desc)    ((void)0)
#define TEST_ASSERT_STR_EQ(actual, exp, desc)  ((void)0)

#define THRUSTER_REGISTER_TEST(name, func)     ((void)0)
#define thruster_test_init()                   ((void)0)
#define thruster_test_poll_serial()            ((void)0)
#define thruster_run_all_tests()               ((void)0)

#endif // THRUSTER_TEST_MODE
#endif // THRUSTER_TESTS_H
