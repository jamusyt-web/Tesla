// tesla_lin_volume.ino
// ESP32 (Arduino core) — Model 3 steering-wheel LIN volume chip.
//
// Two modes (config.h):
//   MODE_SNIFF        — decode & print LIN frames so you can find the scroll
//                       frame's baud/PID/offset/checksum.
//   MODE_SLAVE_INJECT — respond to the target PID with a frame carrying left-
//                       scroll ticks, stepped +1 / -1 every 10 s.
//
// Physical layer (see docs/wiring-and-tap.md):
//   RX: 12V LIN --[10k/3.3k divider]--> LIN_RX_PIN     (NOT inverted)
//   TX: LIN_TX_PIN --[4.7k]--> NPN base; collector on bus; emitter GND
//       => driver INVERTS, so we invert only the TXD signal in firmware.
//
// NOTE: This is prototype scaffolding. The inject path depends on values you
// capture yourself; unverified DBC guesses are left as TODOs in config.h.

#include "config.h"
#include "driver/uart.h"

static const uart_port_t PORT = (uart_port_t)LIN_UART_NUM;

// -------- LIN helpers ------------------------------------------------------

// LIN protected-ID parity: P0 = ID0^ID1^ID2^ID4, P1 = ~(ID1^ID3^ID4^ID5).
static uint8_t linProtectedId(uint8_t id6) {
  id6 &= 0x3F;
  uint8_t p0 =  ((id6>>0)^(id6>>1)^(id6>>2)^(id6>>4)) & 1;
  uint8_t p1 = ~((id6>>1)^(id6>>3)^(id6>>4)^(id6>>5)) & 1;
  return id6 | (p0<<6) | (p1<<7);
}

// LIN checksum over data[] (+ PID when enhanced). Sum with carry, then invert.
static uint8_t linChecksum(const uint8_t* data, uint8_t n, uint8_t pid, bool enhanced) {
  uint16_t sum = 0;
  if (enhanced) sum += pid;
  for (uint8_t i = 0; i < n; i++) {
    sum += data[i];
    if (sum > 0xFF) sum = (sum & 0xFF) + 1;   // fold carry
  }
  return (uint8_t)(~sum);
}

// Pack the signed tick delta into the response template and send data+checksum.
static void sendScrollResponse(int8_t ticks) {
  uint8_t buf[RESPONSE_NBYTES];
  memcpy(buf, RESPONSE_TEMPLATE, RESPONSE_NBYTES);

  // clamp to the signed field width and mask in
  int8_t lo = -(1 << (TICKS_BIT_WIDTH - 1));
  int8_t hi =  (1 << (TICKS_BIT_WIDTH - 1)) - 1;
  if (ticks < lo) ticks = lo;
  if (ticks > hi) ticks = hi;
  uint8_t field = ((uint8_t)ticks) & ((1 << TICKS_BIT_WIDTH) - 1);
  uint8_t mask  = ((1 << TICKS_BIT_WIDTH) - 1) << TICKS_BIT_SHIFT;
  buf[TICKS_BYTE_INDEX] = (buf[TICKS_BYTE_INDEX] & ~mask)
                        | ((field << TICKS_BIT_SHIFT) & mask);

  uint8_t pid = linProtectedId(SCROLL_FRAME_ID);
  uint8_t crc = linChecksum(buf, RESPONSE_NBYTES, pid, LIN_CHECKSUM_ENHANCED);

  // As a slave we transmit ONLY the response (data + checksum). The master
  // (VCLEFT) already sent the break + sync + PID.
  uart_write_bytes(PORT, (const char*)buf, RESPONSE_NBYTES);
  uart_write_bytes(PORT, (const char*)&crc, 1);
}

// -------- UART setup -------------------------------------------------------

static void linUartBegin() {
  uart_config_t cfg = {};
  cfg.baud_rate = LIN_BAUD;
  cfg.data_bits = UART_DATA_8_BITS;
  cfg.parity    = UART_PARITY_DISABLE;
  cfg.stop_bits = UART_STOP_BITS_1;
  cfg.flow_ctrl = UART_HW_FLOWCTRL_DISABLE;
  cfg.source_clk = UART_SCLK_APB;
  uart_driver_install(PORT, 512, 512, 0, NULL, 0);
  uart_param_config(PORT, &cfg);
  uart_set_pin(PORT, LIN_TX_PIN, LIN_RX_PIN,
               UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);

  // Driver transistor inverts the bus, so invert TXD only. RX stays normal.
  uart_set_line_inverse(PORT, UART_SIGNAL_TXD_INV);
}

// -------- Frame reader (shared) --------------------------------------------
// Minimal LIN framer: a break shows up as a 0x00 byte flagged with a framing
// error; we approximate detection by watching for the 0x55 sync after an idle
// gap. Good enough to decode traffic in sniff mode and to trigger on the PID
// in inject mode. Tighten with UART break events (uart_enable_intr_mask /
// pattern detection) once you see how your car frames it.

static uint8_t rxbuf[16];

static int readByteTimeout(uint32_t us) {
  uint8_t b;
  int n = uart_read_bytes(PORT, &b, 1, us / 1000 + 1);
  return (n == 1) ? b : -1;
}

// -------- Modes ------------------------------------------------------------

#if ACTIVE_MODE == MODE_SNIFF
static void loopSniff() {
  // Wait for sync 0x55, then grab PID + up to 8 data + checksum and print.
  int b = readByteTimeout(20000);
  if (b < 0) return;
  if (b != 0x55) return;                 // resync on sync byte
  int pid = readByteTimeout(4000);
  if (pid < 0) return;

  uint8_t data[9]; int n = 0;
  while (n < 9) {
    int d = readByteTimeout(2000);       // gap => end of frame
    if (d < 0) break;
    data[n++] = (uint8_t)d;
  }
  uint8_t id6 = pid & 0x3F;
  Serial.printf("PID=0x%02X (ID=0x%02X) len=%d :", pid, id6, n);
  for (int i = 0; i < n; i++) Serial.printf(" %02X", data[i]);
  Serial.println();
}
#endif

#if ACTIVE_MODE == MODE_SLAVE_INJECT
static uint32_t lastStep = 0;
static int8_t   nextTick = +1;           // +1 up, then -1 down
static int8_t   pendingTicks = 0;        // sent on the next matching poll

static void loopInject() {
  // Time to queue a step?
  uint32_t now = millis();
  if (now - lastStep >= STEP_INTERVAL_MS) {
    lastStep = now;
    pendingTicks = nextTick;
    nextTick = (nextTick > 0) ? -1 : +1;
    Serial.printf("[inject] queued %d tick\n", pendingTicks);
  }

  // Watch for the master header; when our target PID is polled, answer.
  int b = readByteTimeout(20000);
  if (b != 0x55) return;                  // sync
  int pid = readByteTimeout(4000);
  if (pid < 0) return;
  if ((pid & 0x3F) != SCROLL_FRAME_ID) return;

  // Respond with the queued delta (0 the rest of the time = no movement).
  int8_t ticks = pendingTicks;
  pendingTicks = 0;
  sendScrollResponse(ticks);
}
#endif

// -------- Arduino entry points ---------------------------------------------

void setup() {
  Serial.begin(115200);
  delay(200);
  linUartBegin();
  Serial.println(ACTIVE_MODE == MODE_SNIFF
    ? "[mode] SNIFF — decoding LIN frames"
    : "[mode] SLAVE_INJECT — 10s up / 10s down");
}

void loop() {
#if ACTIVE_MODE == MODE_SNIFF
  loopSniff();
#else
  loopInject();
#endif
}
