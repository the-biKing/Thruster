# Event-Driven Architecture (EDA) for Microcontrollers

In embedded microcontroller programming, traditional procedural code tightly couples hardware peripherals (GPIO pins, ADC, hardware timers) with business logic inside `loop()`. This creates two major problems:
1. **Un-testability**: An AI agent or remote developer cannot physically press buttons, turn potentiometers, or trigger external sensors on a physical board sitting on a desk.
2. **Spaghetti State Transitions**: As features expand, deeply nested `if`/`else` trees in `loop()` make firmware brittle and prone to race conditions or lockups.

## The Core EDA Principles for MCUs

### 1. Decouple Stimulus from Response
Hardware pins and interrupts **only** produce events; they do not contain business logic.
- An interrupt service routine (ISR) or a debounce scanner detects a button press and emits `EVENT_BUTTON_PRESSED`.
- The event is handled by a centralized event dispatcher: `dispatch_event(EventType type, int32_t data)`.

```cpp
// Hardware layer emits events
void poll_hardware_inputs() {
    if (check_physical_button()) {
        dispatch_event(EVENT_BUTTON_PRESSED, 0);
    }
}
```

### 2. Pure State Machine Handlers
State transitions occur strictly inside the event dispatcher based on current state and incoming event:

```cpp
enum SystemState { STATE_IDLE, STATE_ACTIVE, STATE_ALARM };
enum EventType   { EVENT_BUTTON_PRESSED, EVENT_TIMEOUT, EVENT_RESET };

void dispatch_event(EventType type, int32_t data) {
    switch (current_state) {
        case STATE_IDLE:
            if (type == EVENT_BUTTON_PRESSED) {
                current_state = STATE_ACTIVE;
                set_actuator_output(true);
            }
            break;
        case STATE_ACTIVE:
            if (type == EVENT_TIMEOUT) {
                current_state = STATE_IDLE;
                set_actuator_output(false);
            }
            break;
        case STATE_ALARM:
            if (type == EVENT_RESET) {
                current_state = STATE_IDLE;
            }
            break;
    }
}
```

### 3. Synthetic Event Injection for AI Agents
Because business logic only depends on `dispatch_event(...)`, the AI agent can inject any hardware event synthetically over the Serial interface using Thruster MCP:
- `CMD:EVENT:2:0` (triggers `EVENT_BUTTON_PRESSED`)
- `CMD:EVENT:5:100` (triggers `EVENT_ALARM_TRIGGER` with payload 100)
- The firmware transitions states identically to physical hardware, allowing complete end-to-end verification!
