// config.h — fill these in from your own LIN capture (sniffer mode).
// Nothing here is hardcoded to unverified DBC values on purpose.
#pragma once

// ---- Mode select ---------------------------------------------------------
// MODE_SNIFF        : passively decode LIN, print frames over USB serial.
// MODE_SLAVE_INJECT : answer the target PID with a response carrying scroll
//                     ticks, driven by the 10s up / 10s down state machine.
#define MODE_SNIFF        0
#define MODE_SLAVE_INJECT 1
#define ACTIVE_MODE       MODE_SNIFF   // <-- start here; switch after capture

// ---- LIN bus parameters (fill from capture) ------------------------------
#define LIN_BAUD          19200        // try 19200 first, then 9600 / 10417

// The 6-bit LIN frame ID (0x00..0x3F) of the scroll/switch response frame.
// This is the ID *without* the two parity bits. Read it from your capture.
#define SCROLL_FRAME_ID   0x26           // CONFIRMED: steering-wheel switch frame

// Where the left-scroll tick value lives in the response and how it's packed.
// Defaults mirror the community DBC (bit offset 16 => byte 2, 6-bit signed),
// but VERIFY against your capture before trusting them.
#define TICKS_BYTE_INDEX  1            // CONFIRMED: byte 1 = scroll (0x40 up, 0xC0 down, 0x00 idle)
#define TICKS_BIT_SHIFT   0            // bit position within that byte
#define TICKS_BIT_WIDTH   6            // signed field width
#define RESPONSE_NBYTES   7            // CONFIRMED: 7 data bytes + enhanced checksum

// Checksum type: enhanced (LIN 2.x, includes PID) or classic (LIN 1.x).
#define LIN_CHECKSUM_ENHANCED 1        // 1 = enhanced, 0 = classic — TODO verify

// If your captured response has other non-zero bytes (mux index, buttons, etc.),
// set them here so VCLEFT sees a valid frame. Index 0..RESPONSE_NBYTES-1.
// Example: the DBC mux selector VCLEFT_switchStatusIndex == 1 lives in byte 0.
static const unsigned char RESPONSE_TEMPLATE[7] = {
  0x5E, 0x00, 0x10, 0x08, 0x5D, 0x9A, 0x00  // CONFIRMED idle 0x26 frame; byte1=0x40 up / 0xC0 down
};

// ---- Timing --------------------------------------------------------------
#define STEP_INTERVAL_MS  10000        // 10 s between volume steps

// ---- Pins (ESP32 WROOM-32; UART2) ----------------------------------------
#define LIN_UART_NUM      2            // UART2
#define LIN_RX_PIN        16           // from RX divider junction
#define LIN_TX_PIN        17           // to NPN base resistor
