// teslasniffer.ino — all-in-one. ESP32 DevKit V1 (WROOM). Sniff + inject.
#include <string.h>
#include "driver/uart.h"

// ===== CONFIG (edit these after your capture) =====
#define MODE_SNIFF        0
#define MODE_SLAVE_INJECT 1
#define ACTIVE_MODE       MODE_SNIFF        // switch to MODE_SLAVE_INJECT later

#define LIN_BAUD          19200
#define SCROLL_FRAME_ID   0x00              // fill from capture
#define TICKS_BYTE_INDEX  2
#define TICKS_BIT_SHIFT   0
#define TICKS_BIT_WIDTH   6
#define RESPONSE_NBYTES   8
#define LIN_CHECKSUM_ENHANCED 1
static const uint8_t RESPONSE_TEMPLATE[8] = { 0x01, 0, 0, 0, 0, 0, 0, 0 };
#define STEP_INTERVAL_MS  10000

#define LIN_UART_NUM      2                 // UART2
#define LIN_RX_PIN        16                // D16 / RX2  (from NODE A)
#define LIN_TX_PIN        17                // D17 / TX2  (to 4.7k/base)

static const uart_port_t PORT = (uart_port_t)LIN_UART_NUM;

static uint8_t linProtectedId(uint8_t id6){
  id6 &= 0x3F;
  uint8_t p0 =  ((id6>>0)^(id6>>1)^(id6>>2)^(id6>>4)) & 1;
  uint8_t p1 = ~((id6>>1)^(id6>>3)^(id6>>4)^(id6>>5)) & 1;
  return id6 | (p0<<6) | (p1<<7);
}
static uint8_t linChecksum(const uint8_t* d, uint8_t n, uint8_t pid, bool enh){
  uint16_t sum = enh ? pid : 0;
  for(uint8_t i=0;i<n;i++){ sum += d[i]; if(sum>0xFF) sum=(sum&0xFF)+1; }
  return (uint8_t)(~sum);
}
static void linUartBegin(){
  uart_config_t cfg = {};
  cfg.baud_rate = LIN_BAUD;
  cfg.data_bits = UART_DATA_8_BITS;
  cfg.parity    = UART_PARITY_DISABLE;
  cfg.stop_bits = UART_STOP_BITS_1;
  cfg.flow_ctrl = UART_HW_FLOWCTRL_DISABLE;
  cfg.source_clk = UART_SCLK_APB;
  uart_driver_install(PORT, 512, 512, 0, NULL, 0);
  uart_param_config(PORT, &cfg);
  uart_set_pin(PORT, LIN_TX_PIN, LIN_RX_PIN, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);
  uart_set_line_inverse(PORT, UART_SIGNAL_TXD_INV);   // NPN driver inverts TX
}
static int readByteTimeout(uint32_t ms){
  uint8_t b;
  int n = uart_read_bytes(PORT, &b, 1, pdMS_TO_TICKS(ms) + 1);
  return (n==1) ? b : -1;
}
static void sendScrollResponse(int8_t ticks){
  uint8_t buf[RESPONSE_NBYTES];
  memcpy(buf, RESPONSE_TEMPLATE, RESPONSE_NBYTES);
  int8_t lo = -(1 << (TICKS_BIT_WIDTH-1));
  int8_t hi =  (1 << (TICKS_BIT_WIDTH-1)) - 1;
  if(ticks<lo) ticks=lo;
  if(ticks>hi) ticks=hi;
  uint8_t field = ((uint8_t)ticks) & ((1<<TICKS_BIT_WIDTH)-1);
  uint8_t mask  = ((1<<TICKS_BIT_WIDTH)-1) << TICKS_BIT_SHIFT;
  buf[TICKS_BYTE_INDEX] = (buf[TICKS_BYTE_INDEX] & ~mask) | ((field<<TICKS_BIT_SHIFT)&mask);
  uint8_t pid = linProtectedId(SCROLL_FRAME_ID);
  uint8_t crc = linChecksum(buf, RESPONSE_NBYTES, pid, LIN_CHECKSUM_ENHANCED);
  uart_write_bytes(PORT, (const char*)buf, RESPONSE_NBYTES);
  uart_write_bytes(PORT, (const char*)&crc, 1);
}

static uint32_t lastStep = 0;
static int8_t   nextTick = +1;
static int8_t   pendingTicks = 0;

void setup(){
  Serial.begin(115200);
  delay(200);
  linUartBegin();
  Serial.println(ACTIVE_MODE==MODE_SNIFF ? "[mode] SNIFF - decoding LIN" : "[mode] INJECT 10s up/down");
}

void loop(){
  if(ACTIVE_MODE==MODE_SNIFF){
    int b = readByteTimeout(20);
    if(b != 0x55) return;
    int pid = readByteTimeout(4);
    if(pid < 0) return;
    uint8_t data[9]; int n=0;
    while(n<9){ int d = readByteTimeout(2); if(d<0) break; data[n++]=(uint8_t)d; }
    Serial.printf("PID=0x%02X (ID=0x%02X) len=%d :", pid, pid & 0x3F, n);
    for(int i=0;i<n;i++) Serial.printf(" %02X", data[i]);
    Serial.println();
  } else {
    uint32_t now = millis();
    if(now - lastStep >= STEP_INTERVAL_MS){
      lastStep = now;
      pendingTicks = nextTick;
      nextTick = (nextTick>0) ? -1 : +1;
      Serial.printf("[inject] queued %d\n", pendingTicks);
    }
    int b = readByteTimeout(20);
    if(b != 0x55) return;
    int pid = readByteTimeout(4);
    if(pid < 0) return;
    if((pid & 0x3F) != SCROLL_FRAME_ID) return;
    int8_t t = pendingTicks; pendingTicks = 0;
    sendScrollResponse(t);
  }
}
