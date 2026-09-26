// phyb_hw_diag.ino
// "No multimeter" hardware diagnostic for PHY-B.
//
// Uses the ESP32's own ADC to read node A2 (GPIO25) as an approximate
// voltmeter, while directly driving GPIO26 HIGH/LOW as a plain digital
// pin (bypassing UART entirely) so we can isolate the transistor +
// divider from any firmware/UART settings.
//
// This does NOT need the car, the module, or the wheel connected.
// Same bench setup as phyb_selftest: PHY-B with its 1k+diode pull-up
// powered from a separate 12V source, ESP32 on USB.
//
// GPIO26 = TX drive pin -> 4.7k -> transistor base
// GPIO25 = RX / node A2 (the ~3V divided point) -> read as an ADC input
//
// What you should see, printed every 2 seconds, alternating:
//   "TX=LOW  (transistor OFF, bus should be RECESSIVE/high) -> A2 = ~2500-3000 mV"
//   "TX=HIGH (transistor ON,  bus should be DOMINANT/low)   -> A2 = ~0-100 mV"
//
// If A2 reads near 0 mV in BOTH states -> no 12V on the pull-up, or the
//   10k/3.3k/A2 wire is broken (bus never reaches node A2 at all).
// If A2 reads the SAME mid-range number in BOTH states (doesn't move
//   when TX toggles) -> the transistor isn't switching (check its 3
//   legs: base/emitter/collector and the 4.7k into the base).
// If A2 swings between ~2500-3000 mV and ~0-100 mV as expected -> PHY-B's
//   hardware is good; the earlier "heard 0" was a firmware/UART issue,
//   not the transceiver itself.

#define TX_PIN 26
#define RX_ADC_PIN 25

static uint32_t readA2mV() {
  // Average a few samples to smooth noise.
  uint32_t sum = 0;
  const int N = 16;
  for (int i = 0; i < N; i++) {
    sum += analogReadMilliVolts(RX_ADC_PIN);
    delay(2);
  }
  return sum / N;
}

void setup() {
  Serial.begin(115200);
  delay(300);
  pinMode(TX_PIN, OUTPUT);
  digitalWrite(TX_PIN, LOW);   // transistor OFF at idle (bus should float high)

  analogSetPinAttenuation(RX_ADC_PIN, ADC_11db);  // lets us read the full 0-3.3V range

  Serial.println();
  Serial.println("PHY-B hardware diagnostic (no multimeter needed)");
  Serial.println("Driving GPIO26 directly, reading node A2 (GPIO25) via ADC.");
  Serial.println();
}

void loop() {
  digitalWrite(TX_PIN, LOW);
  delay(300); // let it settle
  uint32_t mvLow = readA2mV();
  Serial.printf("TX=LOW  (bus should be RECESSIVE/high) -> A2 = %lu mV\n", (unsigned long)mvLow);
  delay(1700);

  digitalWrite(TX_PIN, HIGH);
  delay(300);
  uint32_t mvHigh = readA2mV();
  Serial.printf("TX=HIGH (bus should be DOMINANT/low)    -> A2 = %lu mV\n", (unsigned long)mvHigh);
  delay(1700);

  static int cycles = 0;
  if (++cycles >= 3) {
    cycles = 0;
    Serial.println("---");
    if (mvLow < 200 && mvHigh < 200)
      Serial.println("=> A2 stuck near 0 in both states: no 12V on the pull-up, or 10k/3.3k/A2 wiring broken.");
    else if (mvLow > 1000 && (int)mvLow - (int)mvHigh < 500)
      Serial.println("=> A2 isn't dropping when TX goes HIGH: transistor not switching - recheck E/B/C legs and the 4.7k.");
    else if (mvLow > 2000 && mvHigh < 500)
      Serial.println("=> Looks correct! PHY-B hardware is good.");
    else
      Serial.println("=> Ambiguous - report both numbers.");
    Serial.println("---");
  }
}
