/**
 * Thruster Event-Driven Architecture (EDA) & Testable Firmware Template
 * ---------------------------------------------------------------------
 * This template demonstrates how to structure embedded microcontroller code
 * so it can be autonomously tested by AI agents or human developers over Serial,
 * while remaining 100% detachable for production deployment.
 *
 * DEVELOPMENT & TESTING:
 *   Keep `#define THRUSTER_TEST_MODE 1` enabled. The Thruster MCP server can
 *   trigger tests, inject events, and inspect assertions via Serial.
 *
 * PRODUCTION RELEASE:
 *   Comment out `#define THRUSTER_TEST_MODE 1` (or delete the line).
 *   All test suites, test strings, and test dispatchers compile to exactly 0 bytes!
 */

#define THRUSTER_TEST_MODE 1

#include "tests.h"

// =====================================================================
// 1. Event-Driven Architecture Definitions
// =====================================================================

enum EventType {
    EVENT_NONE = 0,
    EVENT_SYSTEM_BOOT = 1,
    EVENT_BUTTON_PRESSED = 2,
    EVENT_BUTTON_RELEASED = 3,
    EVENT_TIMER_TICK = 4,
    EVENT_ALARM_TRIGGER = 5,
    EVENT_RESET = 6
};

enum SystemState {
    STATE_IDLE = 0,
    STATE_ACTIVE = 1,
    STATE_ALARM = 2
};

// Application State
SystemState current_state = STATE_IDLE;
uint32_t event_counter = 0;
bool led_output_state = false;

// =====================================================================
// 2. Event Dispatcher & State Machine (Core Business Logic)
// =====================================================================

void dispatch_event(EventType type, int32_t data) {
    event_counter++;

    switch (type) {
        case EVENT_SYSTEM_BOOT:
            current_state = STATE_IDLE;
            led_output_state = false;
            break;

        case EVENT_BUTTON_PRESSED:
            if (current_state == STATE_IDLE) {
                current_state = STATE_ACTIVE;
                led_output_state = true;
            } else if (current_state == STATE_ACTIVE) {
                current_state = STATE_IDLE;
                led_output_state = false;
            }
            break;

        case EVENT_ALARM_TRIGGER:
            current_state = STATE_ALARM;
            led_output_state = true;
            break;

        case EVENT_RESET:
            current_state = STATE_IDLE;
            led_output_state = false;
            break;

        default:
            break;
    }
}

// =====================================================================
// 3. Test Suites (Guarded by THRUSTER_TEST_MODE)
// =====================================================================

#if defined(THRUSTER_TEST_MODE)

void test_initial_state_idle() {
    dispatch_event(EVENT_SYSTEM_BOOT, 0);
    TEST_ASSERT_EQ(current_state, STATE_IDLE, "Initial state must be IDLE");
    TEST_ASSERT_FALSE(led_output_state, "LED must be OFF in IDLE state");
}

void test_button_press_toggles_state() {
    dispatch_event(EVENT_SYSTEM_BOOT, 0);

    // First press -> transitions to ACTIVE
    dispatch_event(EVENT_BUTTON_PRESSED, 0);
    TEST_ASSERT_EQ(current_state, STATE_ACTIVE, "First button press must transition to ACTIVE");
    TEST_ASSERT_TRUE(led_output_state, "LED must turn ON in ACTIVE state");

    // Second press -> transitions back to IDLE
    dispatch_event(EVENT_BUTTON_PRESSED, 0);
    TEST_ASSERT_EQ(current_state, STATE_IDLE, "Second button press must return to IDLE");
    TEST_ASSERT_FALSE(led_output_state, "LED must turn OFF in IDLE state");
}

void test_alarm_trigger_overrides_to_alarm() {
    dispatch_event(EVENT_SYSTEM_BOOT, 0);
    dispatch_event(EVENT_ALARM_TRIGGER, 100);

    TEST_ASSERT_EQ(current_state, STATE_ALARM, "Alarm event must switch state to ALARM");
    TEST_ASSERT_TRUE(led_output_state, "LED must be ON in ALARM state");
}

void test_reset_clears_alarm() {
    current_state = STATE_ALARM;
    dispatch_event(EVENT_RESET, 0);

    TEST_ASSERT_EQ(current_state, STATE_IDLE, "Reset must restore state to IDLE");
    TEST_ASSERT_FALSE(led_output_state, "LED must be OFF after reset");
}

// Register all tests with the Thruster Test Harness
void register_project_tests() {
    THRUSTER_REGISTER_TEST("initial_state_idle", test_initial_state_idle);
    THRUSTER_REGISTER_TEST("button_press_toggles", test_button_press_toggles_state);
    THRUSTER_REGISTER_TEST("alarm_trigger_state", test_alarm_trigger_overrides_to_alarm);
    THRUSTER_REGISTER_TEST("reset_clears_alarm", test_reset_clears_alarm);
}

// Hook called when AI agent injects an event command over Serial
void on_thruster_event_command(int type, int32_t data) {
    dispatch_event((EventType)type, data);
}

#endif // THRUSTER_TEST_MODE

// =====================================================================
// 4. Arduino Lifecycle (setup & loop)
// =====================================================================

void setup() {
    Serial.begin(115200);

    // Initialize business logic
    dispatch_event(EVENT_SYSTEM_BOOT, 0);

    // Initialize test harness (compiles away to ((void)0) in production)
    thruster_test_init();

    Serial.println(F("Thruster MCU Firmware Initialized."));
}

void loop() {
    // 1. Hardware IO / Sensor Polling (if any)
    // When physical buttons or sensors trigger, call dispatch_event(...)

    // 2. Poll for AI agent / developer test commands over Serial
    // (compiles away to ((void)0) when THRUSTER_TEST_MODE is disabled)
    thruster_test_poll_serial();
}
