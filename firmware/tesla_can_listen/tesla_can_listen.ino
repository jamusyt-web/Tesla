// tesla_can_listen.ino
// Step 1 of the CAN path: LISTEN-ONLY sniffer for the steering-wheel scroll
// message on Tesla Vehicle CAN. It cannot transmit (hardware listen-only mode),
// so it is safe to plug into the car first.
//
// Goal: prove we are on the right bus by seeing 0x3C2 (VCLEFT_switchStatus)
// at ~50 Hz, and watching the scroll ticks change when you roll the left wheel.
//
// ---- Hardware ---------------------------------------------------------------
// ESP32 DevKit V1 (WROOM)  +  SN65HVD230 CAN transceiver breakout
//
//   ESP32 3V3   -> SN65HVD230 VCC (3.3 V)
//   ESP32 GND   -> SN65HVD230 GND   (and to the car's GND)
//   ESP32 GPIO21 (CAN TX) -> SN65HVD230 CTX  (labelled D / TXD / CTX)
//   ESP32 GPIO22 (CAN RX) <- SN65HVD230 CRX  (labelled R / RXD / CRX)
//   SN65HVD230 RS -> GND (high-speed mode; many boards do this already)
//   SN65HVD230 CANH / CANL -> the car's CAN-H / CAN-L pair
//
//   !! Remove / do not bridge the 120 ohm termination resistor on the breakout.
//      The car's bus is already terminated; we are a stub tap.
//
// ---- 2024 Model Y (legacy body, HW4): where to tap ---------------------------
// 26-pin X179 connector behind the FRONT PASSENGER kick panel.
//   Built BEFORE April 2024 : Vehicle CAN on pins 9 / 10   (CAN-H / CAN-L)
//   Built April 2024 or later: Vehicle CAN on pins 18 / 19 (the only CAN pair;
//                              9/10 and 12/13 became Ethernet/DoIP - not CAN)
//   +12 V = pin 15, GND = pin 26.
// Check the build month on the driver door-jamb sticker, then METER-VERIFY:
// with the car awake, each CAN pin reads ~2.5 V to ground and twitches.
//
// Serial Monitor: 115200 baud.

#include "driver/twai.h"

#define CAN_TX_PIN   GPIO_NUM_21
#define CAN_RX_PIN   GPIO_NUM_22
#define SCROLL_ID    0x3C2          // VCLEFT_switchStatus (Model 3 / Y)

// ---- decode helpers (opendbc tesla_model3_vehicle.dbc) --------------------
static int8_t signExtend6(uint8_t v) {
  v &= 0x3F;
  return (v & 0x20) ? (int8_t)(v | 0xC0) : (int8_t)v;
}

// ---- stats ------------------------------------------------------------------
static uint32_t framesTotal = 0, framesScroll = 0;
static uint32_t lastReport = 0;
static uint32_t idsSeen[64]; static int nIds = 0;
static int8_t   lastLeftPressed = -1, lastRightPressed = -1;

static void noteId(uint32_t id) {
  for (int i = 0; i < nIds; i++) if (idsSeen[i] == id) return;
  if (nIds < 64) idsSeen[nIds++] = id;
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println("Tesla CAN listen-only sniffer  (TX=GPIO21, RX=GPIO22, 500 kbit/s)");
  Serial.println("Mode: LISTEN-ONLY - this sketch cannot transmit.");
  Serial.println("Looking for 0x3C2 VCLEFT_switchStatus. Roll the LEFT scroll wheel to see ticks.");
  Serial.println();

  twai_general_config_t g = TWAI_GENERAL_CONFIG_DEFAULT(CAN_TX_PIN, CAN_RX_PIN, TWAI_MODE_LISTEN_ONLY);
  g.rx_queue_len = 64;
  twai_timing_config_t t = TWAI_TIMING_CONFIG_500KBITS();
  twai_filter_config_t f = TWAI_FILTER_CONFIG_ACCEPT_ALL();

  if (twai_driver_install(&g, &t, &f) != ESP_OK) { Serial.println("!! TWAI driver install failed"); while (1) delay(1000); }
  if (twai_start() != ESP_OK)                    { Serial.println("!! TWAI start failed");          while (1) delay(1000); }
  twai_reconfigure_alerts(TWAI_ALERT_BUS_ERROR | TWAI_ALERT_ERR_PASS | TWAI_ALERT_BUS_OFF, NULL);
  lastReport = millis();
}

void loop() {
  twai_message_t m;
  while (twai_receive(&m, 0) == ESP_OK) {
    framesTotal++;
    noteId(m.identifier);

    if (m.identifier == SCROLL_ID && !m.extd && m.data_length_code >= 4) {
      framesScroll++;
      uint8_t mux = m.data[0] & 0x03;                  // VCLEFT_switchStatusIndex
      if (mux == 1) {
        int8_t  leftTicks  = signExtend6(m.data[2]);   // swcLeftScrollTicks  16|6-
        int8_t  rightTicks = signExtend6(m.data[3]);   // swcRightScrollTicks 24|6-
        uint8_t leftPress  = (m.data[0] >> 5) & 0x03;  // swcLeftPressed       5|2
        uint8_t rightPress = (m.data[1] >> 4) & 0x03;  // swcRightPressed     12|2

        bool pressChanged = (leftPress != lastLeftPressed) || (rightPress != lastRightPressed);
        if (leftTicks != 0 || rightTicks != 0 || pressChanged) {
          Serial.printf("0x3C2 mux=1  LEFT ticks=%+d press=%u | RIGHT ticks=%+d press=%u | raw:",
                        leftTicks, leftPress, rightTicks, rightPress);
          for (int i = 0; i < m.data_length_code; i++) Serial.printf(" %02X", m.data[i]);
          Serial.println();
        }
        lastLeftPressed = leftPress; lastRightPressed = rightPress;
      }
    }
  }

  uint32_t alerts;
  if (twai_read_alerts(&alerts, 0) == ESP_OK) {
    if (alerts & TWAI_ALERT_BUS_OFF)   Serial.println("!! BUS OFF - wrong bitrate/wiring? power-cycle the board");
    if (alerts & TWAI_ALERT_ERR_PASS)  Serial.println("!! error-passive - check CAN-H/CAN-L swap, termination, bitrate");
  }

  uint32_t now = millis();
  if (now - lastReport >= 2000) {
    float sec = (now - lastReport) / 1000.0f;
    float fps = framesTotal / sec, sps = framesScroll / sec;
    Serial.printf("[%lus] frames/s=%.0f  unique IDs=%d  0x3C2/s=%.0f  -> ",
                  (unsigned long)(now / 1000), fps, nIds, sps);
    if (framesTotal == 0)        Serial.println("NO FRAMES: check wiring, RS->GND, bitrate, that the car is awake");
    else if (framesScroll == 0)  Serial.println("bus is alive but NO 0x3C2: probably the wrong CAN pair (need Vehicle CAN)");
    else                         Serial.println("0x3C2 PRESENT - you are on Vehicle CAN. Roll the left wheel.");
    framesTotal = 0; framesScroll = 0; lastReport = now;
  }
}
