# Wiring, wire identification, and the tap/splice procedure

Everything you need at the car. Read the whole thing once before you start.

---

## 0. Safety — read first

- **The airbag is live.** The steering wheel carries the driver airbag squib. An
  accidental short can deploy it. Before removing the airbag or probing anything:
  - Park, ignition off, **open the driver door and wait** (let the car fully sleep).
  - **Disconnect the 12 V battery** (frunk / rear, per your car) and wait
    **several minutes** before working near the airbag connectors.
  - The airbag connector is typically **yellow/orange**, often twisted-pair, with a
    **shorting clip**. **Do not probe, tap, cut, backprobe, or go near it.** You do
    not need it for this project — leave it fully connected/untouched.
- Only ever touch the **LIN signal wire, its 12 V feed, and ground.**
- If you are not 100% sure which wire is which, **stop and sniff** (Section 3)
  before cutting anything.

---

## 1. Why we identify wires empirically (not from a pinout chart)

The factory pin/color map lives in Tesla's paywalled service manual and varies by
year and connector revision. Trusting a forum pinout next to an airbag is a bad
trade. You already own the tools to identify the three wires you care about with
certainty — do that instead. It takes ten minutes and removes all doubt.

The connector we care about is the **steering-wheel control / switch connector**
(the one feeding the scroll wheels & buttons — *not* the yellow airbag connector,
and not the horn/heater if separate). It carries at minimum: **12 V, ground, and a
single LIN signal wire.**

---

## 2. Signatures of each wire (multimeter)

With the car **awake** (press brake / open door so the wheel controls are powered),
measure each candidate wire in the control connector to chassis ground:

| Wire | DC voltage to GND | Behavior |
|------|-------------------|----------|
| **12 V feed** | ~12–14 V, **steady** | Doesn't change when you use the wheel |
| **Ground** | 0 V, continuity to chassis | Beeps on continuity to bare chassis metal |
| **LIN** | **~9–12 V idle, but flickers/drops** | Twitches when you roll the scroll wheel (it's digital traffic) |
| Heated wheel (if present) | switched / higher current | Not a low-current signal line; ignore |

A cheap multimeter will show LIN as a jumpy/averaged voltage below 12 V because
it's pulsing. That "jumpy" line is your LIN candidate — **confirm it on the analyzer
in Section 3 before cutting.**

---

## 3. Confirm LIN with the logic analyzer (non-destructive)

**Never feed the raw wire into the analyzer or ESP32 — it's ~12 V.** Use the divider.

1. Build the receive divider on the breadboard:
   ```
   wire under test ──[ 10 kΩ ]──┬──► analyzer channel (and later ESP32 RX)
                                 │
                              [ 3.3 kΩ ]
                                 │
                                GND  (common with the car's ground!)
   ```
   Junction sits at ~3.0 V when the wire is at 12 V — safe for the 5 V-tolerant
   analyzer and the 3.3 V ESP32. Use **22 kΩ + 6.8 kΩ** if you want to load the car
   bus even less (~2.8 V).
2. **Backprobe** the candidate pin (slip a fine wire/probe into the back of the
   connector alongside the wire — no cutting) and connect the divided signal to a
   logic-analyzer channel. Share ground with the car.
3. Capture in PulseView (or the analyzer's app) at ≥1 MHz sampling. LIN looks like:
   - a long **break** (dominant/low ~13 bit-times), then
   - a **sync** byte `0x55`, then a **PID**, then data bytes, then a checksum.
4. Set the UART/LIN decoder. Try **19200 baud** first (also 9600, 10417). When the
   bytes decode cleanly, that wire **is** LIN and you've got the baud rate.
5. **Roll the left scroll wheel** while capturing. Note which **PID** carries a byte
   that changes with your scrolling — that's the frame you'll target. Record:
   - **baud rate**
   - the **PID** of the scroll frame (the ID byte after `0x55`)
   - the **byte offset** within the response where the tick value lives
   - the **checksum type**: does the checksum include the PID (**enhanced**, LIN 2.x)
     or not (**classic**, LIN 1.x)? Compute both and see which matches the capture.

Put those four things into `firmware/tesla_lin_volume/config.h`.

---

## 4. The discrete LIN transceiver (bench + car)

### Receive (level-shift down) — non-inverting
Same divider as Section 3, junction → ESP32 **RX** GPIO.

### Transmit (pull the bus dominant) — use an NPN, invert in firmware
```
        +12V (bus supply / car)
          │
        [ 1 kΩ ]        ← MASTER pull-up. Present on the car already (VCLEFT).
          │                Add this ONLY on the bench, or on the switch-module
          │                side of a relay. In series with a diode (kit 1N4148),
          │                band toward the bus, is the correct master termination.
   ┌──────┴───────── LIN bus wire
   │                       │
   │                   [ 10 kΩ ]──┬── ESP32 RX (via the divider above)
   │                              [3.3kΩ]
   │                               │GND
   │  collector
  (C) 2N2222 / 2N3904 (NPN)
   │
  (B) base ──[ 4.7 kΩ ]── ESP32 GPIO (TX)
   │
  (E) emitter ── GND (common with car)
```
- GPIO/TX **high** → NPN **on** → bus pulled **low** = **dominant (0)**.
- GPIO/TX **low**  → NPN **off** → pull-up brings bus **high** = **recessive (1)**.
- Because the driver inverts, **invert the UART TX signal in firmware** (the code
  calls `uart_set_line_inverse(..., UART_SIGNAL_TXD_INV)`). **RX is not inverted.**
- **On the car, do NOT add the 1 kΩ pull-up** — VCLEFT already provides it. Adding a
  second strong pull-up disturbs the bus.

Why NPN and not the 2N7000: the 2N7000's gate threshold (up to 3.0 V) is marginal at
3.3 V drive and could fail to pull a full dominant. A bipolar transistor turns on
hard at ~0.7 V base regardless, sinks the ~12 mA easily, and saturates (~0.2 V) —
a guaranteed valid dominant. This is the textbook discrete LIN/K-line driver.

### Grounding
The ESP32 ground **must** be common with the car's ground. Tie your board ground to
the car ground wire (or chassis). LIN is ground-referenced; without a common ground
nothing decodes.

---

## 5. Choosing the tap topology

| Topology | Wiring | Real buttons keep working? | Fault-code risk | Use when |
|----------|--------|----------------------------|-----------------|----------|
| **Parallel tap (spoof-slave)** | T-tap the LIN wire (no cut) | ❌ (you answer for the module) | Possible "slave not responding" | Quick proof; simplest |
| **Inline relay (hard-wired passthrough)** | **Cut** LIN, device in series with a PHY on each side | ✅ | None (module still answers) | The "flawless" version |

- A true **plug-in** passthrough would need two genuine Tesla connectors (can't be
  3D-printed, slow to source) — **skip it.** The **hard-wired** inline relay is
  electrically identical and needs no Tesla connector.
- For the relay you need **two** discrete PHYs (one per side) and the master pull-up
  (1 kΩ + diode) on the **switch-module** side, because your box is now the master
  that polls the module.

---

## 6. The splice (inline relay)

You have solder-seal butt connectors / T-taps and the JST-Dupont crimp kit.

1. With the 12 V battery disconnected and the airbag safely set aside (untouched
   connector), locate the confirmed **LIN wire** in the control connector's harness.
2. **Cut the LIN wire.** Extend both cut ends with your 22 AWG hookup wire:
   - VCLEFT/clockspring side → your board's **master-side** PHY.
   - Switch-module side → your board's **slave-side** PHY.
3. Splice with **solder-seal butt connectors** (heat to flow solder + shrink the
   seal) or solder + heat-shrink. Keep joints staggered so the bundle stays slim.
4. Tap **12 V** and **ground** with T-taps (no cut needed) to feed the buck → ESP32.
   Confirm 12 V and GND with the meter *before* connecting the buck.
5. Put a **JST or Dupont** connector (crimp kit) between the spliced-in pigtail and
   your electronics box, so the box unplugs. This is the only "connector you make,"
   and it's a standard hobby connector — nothing Tesla-specific.
6. Print a **PETG** enclosure for the board and a clip to retain it in the wheel.
   (PETG, not PLA — a cabin gets hot enough to sag PLA.)

For a **parallel tap** instead: skip the cut, T-tap the LIN wire directly to your
single PHY, and don't add a pull-up.

---

## 7. Bench rig (do this before the car)

1. 12 V bench supply (or a 12 V wall adapter) = your fake bus supply.
2. Breadboard: 1 kΩ pull-up (+ diode) from a "bus" rail to 12 V; the NPN driver;
   the RX divider; ESP32.
3. Flash `MODE_SLAVE_INJECT`, watch the bus on the analyzer, and confirm your board
   emits a clean response with the right PID + checksum, and that the 10 s state
   machine toggles +1 / −1. Only then go to the car.

---

## 8. Checklist before power-on in the car

- [ ] Airbag connector untouched; 12 V was disconnected during the splice.
- [ ] Meter-confirmed: 12 V wire ~12 V, ground = 0 V/continuity, LIN confirmed on
      the analyzer.
- [ ] Divider in place on RX (no raw 12 V to the ESP32/analyzer).
- [ ] NO extra pull-up added on the car side (VCLEFT provides it).
- [ ] Common ground between the ESP32 and the car.
- [ ] TX inverted in firmware; RX not inverted.
- [ ] `config.h` filled from your real capture (baud, PID, offset, checksum type).
