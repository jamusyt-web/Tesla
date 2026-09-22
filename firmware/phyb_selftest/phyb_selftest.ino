// phyb_selftest.ino
// Proves the SECOND LIN transceiver ("PHY-B") is wired correctly, on the bench.
//
// PHY-B uses UART1:  RX = GPIO25,  TX = GPIO26.
// This is an EXACT copy of the transceiver you already built for PHY-A,
// just on new pins and new breadboard columns.
//
// For the self-test, PHY-B's bus MUST have the bench pull-up present:
//   1k resistor + diode (band toward the bus) from the bus up to +12V.
// The ESP32 transmits a tiny frame and listens to its OWN bus (loopback).
// If it hears back what it sent, PHY-B can both DRIVE and READ the bus.
//
// USB goes to the laptop. 12V feeds only the 1k+diode pull-up (and the buck,
// if that's how you're making 12V). Nothing from the car is connected yet.

#include "driver/uart.h"

#define PHYB_UART 1
#define PHYB_RX   25
#define PHYB_TX   26
#define LIN_BAUD  19200

static const uart_port_t B = (uart_port_t)PHYB_UART;

static void beginPhyB() {
  uart_config_t cfg = {};
  cfg.baud_rate  = LIN_BAUD;
  cfg.data_bits  = UART_DATA_8_BITS;
  cfg.parity     = UART_PARITY_DISABLE;
  cfg.stop_bits  = UART_STOP_BITS_1;
  cfg.flow_ctrl  = UART_HW_FLOWCTRL_DISABLE;
  cfg.source_clk = UART_SCLK_APB;
  uart_driver_install(B, 512, 512, 0, NULL, 0);
  uart_param_config(B, &cfg);
  uart_set_pin(B, PHYB_TX, PHYB_RX, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);
  // The NPN driver inverts, so invert TXD only (same as PHY-A). RX stays normal.
  uart_set_line_inverse(B, UART_SIGNAL_TXD_INV);
}

void setup() {
  Serial.begin(115200);
  delay(300);
  beginPhyB();
  Serial.println();
  Serial.println("PHY-B self-test  (UART1: RX=GPIO25, TX=GPIO26)");
  Serial.println("Sending 55 A6 12 34 once a second and listening to its own bus.");
  Serial.println("Expect: heard 55 A6 12 34  <-- PASS");
  Serial.println();
}

void loop() {
  uart_flush_input(B);

  const uint8_t frame[] = {0x55, 0xA6, 0x12, 0x34};
  uart_write_bytes(B, (const char*)frame, sizeof(frame));

  uint8_t rx[16];
  int n = 0;
  uint32_t t0 = millis();
  while (millis() - t0 < 40 && n < 16) {
    uint8_t b;
    if (uart_read_bytes(B, &b, 1, pdMS_TO_TICKS(5)) == 1) rx[n++] = b;
  }

  Serial.printf("sent 55 A6 12 34  |  heard %d:", n);
  for (int i = 0; i < n; i++) Serial.printf(" %02X", rx[i]);

  if (n >= 4 && rx[0] == 0x55 && rx[1] == 0xA6 && rx[2] == 0x12 && rx[3] == 0x34)
    Serial.print("   <-- PASS: PHY-B drives & reads the bus");
  else if (n == 0)
    Serial.print("   <-- heard NOTHING: no pull-up/12V, or RX not on node A2");
  else
    Serial.print("   <-- garbled: check the transistor legs / TX resistor");

  Serial.println();
  delay(1000);
}
