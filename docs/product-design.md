# Tesla Wheel-Control Injector — Product Design

**Status:** design locked (2026-09) · supersedes the LIN-at-the-wheel relay for the
product goal. The LIN relay still works on a single Model 3 and is kept in the repo
as a reference build, but it is **not** the product architecture.

---

## 1. The decision (TL;DR)

**Inject the scroll signal on the vehicle CAN bus from the car's diagnostic / X179 plug** —
one electronics core, a small family of plug-in cables, and a per-platform firmware
profile table. This is the final call after a full per-platform review (§2), and it
reverses an interim "universal wheel passthrough" draft.

Why it reverses: the steering-wheel harness is common **only within Model 3/Y 2017–2023**.
Every other platform's wheel is electrically different — S/X ≤2020 runs its wheel LIN
straight to the Gateway; S/X 2021+ is a new force-touch architecture; Highland/Juniper is a
capacitive stalkless wheel; Cybertruck's wheel lives on EtherLoop steer-by-wire. The one
vendor that actually built wheel-side units needed **four** wheel variants, then abandoned
the wheel for the plug, citing easier install *and more stable operation*. So there is **no
universal connector on either route**, and once both routes need a cable family, the plug
wins on install, safety, stability, and field precedent.

What "works on every Tesla" honestly means (§2.2): about **5 cable SKUs + 5 firmware
profiles** cover Model 3/Y (all generations with CAN ports), S/X legacy, and S/X refresh.
**Cybertruck and DoIP/Ethernet-only ports are out of scope for a CAN device** and need a
separate Ethernet-class variant.

**Scope note.** This device is for benign controls (volume / media scroll). Aftermarket
devices that use wheel-scroll injection to defeat driver-attention monitoring have drawn
NHTSA enforcement as regulated motor-vehicle equipment; the product must not be designed
or marketed for that purpose.

---

## 2. Per-platform review — why no route has a universal connector

### 2.1 How each car's wheel controls actually work

| Platform | Wheel controls path | Wheel-side connector | CAN scroll message |
|---|---|---|---|
| Model 3 / Y 2017–2023 | LIN → **VCLEFT** → Vehicle CAN | **common across 3/Y** (the field observation holds here) | `0x3C2 VCLEFT_switchStatus`, mux=1, `swcLeftScrollTicks` 16\|6 signed, `swcLeftPressed` 5\|2 — **no counter/CRC** (opendbc) |
| Model 3 Highland / Y Juniper 2024+ | capacitive stalkless wheel → body controller | different (wheel not interchangeable with 2017–23) | HW4-family profile; scroll on mux=1 reported present |
| Model S/X 2012–2020 | wheel switches LIN **direct to the Gateway** (connector X163) | different (switch/harness assembly 1013242-xx) | `0x45 STW_ACTN_RQ` from the STW node — 16 switch inputs, **with message counter + CRC** |
| Model S/X 2021+ (Palladium) | new force-touch yoke/round architecture, stalkless | different (touch-horn vs mechanical-horn variants) | Palladium profile (HW3/MCU3); separate cable |
| Cybertruck | steer-by-wire; wheel on the **EtherLoop** dual-redundant network | different | no conventional CAN/LIN wheel path → out of scope for a CAN device |

Consequences:

- The wheel-side approach needs a different harness **and** a different LIN master /
  schedule per platform. The wheel-version vendor shipped TSL1/2 (Model 3/Y) plus three
  TSL5 variants (S/X ≤2020, S/X 2021+, Highland) — four SKUs, all inside the wheel.
- Legacy S/X injection on CAN must satisfy a **counter + CRC** on `STW_ACTN_RQ`, so that
  profile is more work than Model 3's (which has neither).
- Cybertruck is a hardware gap for **every** route; so are DoIP/Ethernet-only ports.

### 2.2 Route comparison — both need a family, so the plug wins

| | Wheel-side LIN relay | CAN at diagnostic plug |
|---|---|---|
| Connector variants | ≥4 wheel harnesses, inside a rotating wheel | ~5 plug-in cables |
| Electronics | one board | one board |
| Firmware | per-platform LIN profiles (masters differ: VCLEFT vs Gateway vs Palladium) | per-platform CAN profiles — already mapped in open source for HW1/2, HW3, HW4/Highland, Palladium |
| Install | wheel shroud, airbag-adjacent | plug-in |
| Field precedent | vendors built it, then abandoned it | every vendor converged here; reported more stable |
| Gaps | Cybertruck; capacitive wheels unverified | Cybertruck (EtherLoop); DoIP-only ports |

**Verdict:** CAN at the plug. The wheel relay remains a valid single-car experiment on a
2017–2023 Model 3 (the repo keeps it), but it is not the product.

---

## 3. The target signal

| Item | Value |
|---|---|
| Bus | **Vehicle CAN**, 500 kbit/s |
| Message (Model 3/Y) | `0x3C2` `VCLEFT_switchStatus`, multiplexed |
| Mux gate | `VCLEFT_switchStatusIndex == 1` (scroll data present) |
| Left scroll (volume) | `VCLEFT_swcLeftScrollTicks` — bit 16, 6-bit **signed** delta |
| Right scroll | `VCLEFT_swcRightScrollTicks` — bit 24, 6-bit signed delta |
| Meaning | `+1` = up one notch, `-1` = down one notch, `0` = no movement |
| Integrity fields | **None** — the `*_switchStatus` messages carry **no counter/CRC** |

The absence of a rolling counter or checksum (confirmed against the symmetric
`0x3C3 VCRIGHT_switchStatus` in the community DBC, which has no `Counter`/`Checksum`/
`CRC` signals) means an injected frame does **not** have to satisfy an integrity
check — a major feasibility win.

---

## 4. Access points (where to plug in), by model

Vehicle CAN is reachable **without cutting anything**. Exact pins vary by build, so
**always oscilloscope- or meter-verify before powering the transmitter.**

| Model / year | Connector | Vehicle-CAN pins | 12 V / GND | Notes |
|---|---|---|---|---|
| Model 3 2017–2018 | white/black diag connector, driver footwell | via adapter (early "no OBD" cars) | from harness | Use a known Model 3 diagnostic pigtail |
| Model 3 2019 (pre-facelift) | **X052** | pins 44/45 (CAN) | 20/22 | Different connector than later cars |
| Model 3 2019+ / Model Y | 26-pin diag connector (driver footwell) | **18 / 19** (CAN-H / CAN-L) | present | Most common, cheap adapters exist |
| Model 3/Y (2021–2023) | **X179** (passenger kick panel) | Bus 2 on 9/10; Chassis on 18/19 | pin 1 = +12 V, pin 20 = GND | Multi-bus + power in one plug |
| Model 3/Y post-Apr-2024 (26-pin) | X179 26-pin | **only 18/19 works**; 9/10 & 12/13 are **DoIP/Ethernet** | 15 = +12 V, 26 = GND | **Verify — do not assume old layout** |
| Model S/X 2012–2020 | Tesla diagnostic connector | per wk057 deciphering | present | Older CAN map |
| Model S/X refresh (yoke) | diag connector | profile TBD | present | Capacitive + scroll; message set differs |
| Cybertruck | diag connector | profile TBD | present | Steer-by-wire; message set differs |
| 2025+ "Standard" 3/Y & DoIP-only | Ethernet/DoIP | **not CAN** | — | **Needs the DoIP hardware variant (§9)** |

Preferred point for Model 3/Y: the **driver-footwell diagnostic connector, Vehicle
CAN on pins 18/19** (this is where scan tools and comma.ai harnesses attach), or
**X179** if 12 V from the same plug is convenient.

---

## 5. Hardware architecture (one core, small adapters)

```
   Tesla CAN (H/L) ── [CAN transceiver] ── ESP32 TWAI (RX/TX) ── firmware
        │                 SN65HVD230                 │
   12 V ┴─ [12→5 V buck] ─────────────────────────── 5 V in
```

**Bill of materials (core, ~$20):**

| Part | Example | Why |
|---|---|---|
| ESP32 dev board | ESP32-WROOM DevKit (already owned) | Built-in **TWAI** CAN controller — no MCP2515 needed |
| CAN transceiver | **SN65HVD230** breakout (3.3 V) | Direct ESP32-logic-level; TJA1051 (5 V) also fine w/ level care |
| 12→5 V buck | any 2 A automotive buck | Powers ESP32 from the car's 12 V |
| Wiring adapter | model-specific diag/X179 pigtail | The only per-model *hardware* piece |

**Termination:** the vehicle CAN is already terminated (120 Ω at each end). This is a
**stub tap**, so **remove/disable the 120 Ω resistor** many SN65HVD230 boards ship with,
or the bus is over-terminated.

Alternative single-box boards with the transceiver already integrated: **LILYGO
T-CAN485**, **Waveshare ESP32-S3-CAN**, **M5Stack ATOM + ATOMIC CAN** — any of these
replaces the ESP32+SN65HVD230 pair.

### 5.1 Connectorization & mass production

**One board + one firmware + a small family of plug-in cables.** There is no universal
connector on any route (§2): the wheel harness is shared only within Model 3/Y 2017–2023,
and diagnostic connectors vary by generation. So "works on every Tesla" is **one
electronics core + ~5 cable SKUs + ~5 firmware profiles** — never a single universal cable.
Every commercial CAN equivalent (Enhauto Commander, S3XY, the plug-in modules) ships
per-fitment cables; that is the norm, not a compromise.

There is no cheap consumer "CAN cable" because the product doesn't use one — it uses the
**bare mating connector**, which is a standard, bulk automotive part:

- **X179** (accessory/diagnostic connector, Model 3/Y/S/X): **Sumitomo 6098-5620**,
  Tesla P/N **1042620-02-A**. Housings + terminals sell in volume; aftermarket 3-CAN
  commanders already wire to X179's CAN pairs and 12 V.
- Footwell diagnostic connectors (26-pin, early Model 3, legacy S/X) are likewise
  standard housings sourced the same way.

**Per-unit BOM at volume (~$15–25):** ESP32-class module, transceiver (~$1), buck,
enclosure, and **one molded T-harness**. Consumer LAN001/CAN001 kits are skipped.

**Harness SKU family (covers the whole fleet):**

| SKU | Fitment | Connector |
|---|---|---|
| H1 | Model 3 2017–2018 | early footwell diag |
| H2 | Model 3 2019+ / Model Y | 26-pin footwell **or** X179 (Sumitomo 6098-5620) |
| H3 | Model S/X 2012–2020 | legacy diagnostic |
| H4 | Model S/X refresh 2021+ | diagnostic |
| H5 | Cybertruck | diagnostic |
| H6 | DoIP/Ethernet-only (2024+ Juniper, 2025 "Standard") | **needs the Ethernet board variant, not CAN** |

The electronics and firmware are identical across H1–H5; only the pigtail changes. H6 is
the single genuine hardware fork.

**Prototype vs product:** the design covers all models, but the *first physical unit*
must still be proven on **one** real car (its connector + its scroll profile). That first
target doesn't limit the product — it's just the first row of the profile table and the
first harness SKU.

---

## 6. Firmware: one binary, per-model profiles

The firmware is model-independent; a **profile table** holds what differs:

```c
typedef struct {
  const char* name;        // "Model3_2019_2023"
  uint32_t    scroll_id;   // 0x3C2
  uint8_t     mux_byte, mux_shift, mux_value;   // switchStatusIndex == 1
  uint8_t     left_start_bit, left_len;         // 16, 6  (signed)
  bool        signed_field;
  uint16_t    tx_period_ms; // how the car expects the frame cadence
} scroll_profile_t;
```

Boot flow:

1. **Listen only** for N seconds. Confirm we see the profile's `scroll_id` at ~50 Hz.
2. Auto-select / confirm the profile (or let the user pick).
3. Run the 10 s state machine: emit one frame with `ticks=+1`, ten seconds later one
   with `ticks=-1`, repeat. Every other frame carries `ticks=0`.

Per-model profiles ship as a table; adding a car = adding a row after a short capture,
never new hardware.

---

## 7. Injection method, contention, and safety

**Method.** Scroll ticks are *deltas*, so moving the volume one notch = getting the
receiver to see **one** `0x3C2` frame with `swcLeftScrollTicks = +1`. VCLEFT is already
transmitting `0x3C2` continuously with `ticks = 0`.

**Contention (the one real hazard).** Two nodes transmitting the same CAN ID can collide
in the arbitration/data phase and produce error frames. Mitigations, in order:

1. **Rely on standard CAN behavior first.** A controller only starts sending on an idle
   bus and auto-retries on error; a single benign frame slipped in is what every
   commercial module already does successfully.
2. **Phase the injection** — transmit just after we *see* VCLEFT's `0x3C2`, into the
   gap before its next one, to minimize same-ID overlap.
3. **Never target safety IDs.** We only ever transmit the scroll `switchStatus` ID.
   We do **not** touch `0x370` EPAS torque or any steering/brake message — that is the
   line that caused the reported AEB events in the torque-based nag-killers.

**Safety guardrails baked into firmware:**

- **Listen-first**; refuse to transmit until the expected scroll ID is observed.
- **Allow-list of exactly one TX ID**; everything else is read-only.
- **Park-only test mode** for first bring-up; no transmission above 0 mph until proven.
- Reading the bus is always passive and safe.

---

## 8. Commercial precedent (evidence this works)

- **Modern nag modules (TSL6, tlyard/evooor/teslaunch/AFA):** newest versions install
  at the **OBD/diagnostic connector**, not the wheel, and "trigger the volume every
  5–10 s, simulating hand rolling of the wheel" — i.e. CAN scroll injection, plug-in,
  no teardown. Advertised for Model 3/Y/S/X and Cybertruck.
- **Enhauto S3XY Buttons + Commander:** a commercial **CAN device** that injects control
  commands across **Model S/3/X/Y**; the vendor updates firmware when Tesla changes IDs.
  This is the exact "one CAN core + per-model firmware profiles" architecture, shipping
  at scale. (Notably **not** compatible with the 2025+ cost-reduced "Standard" 3/Y — a
  real example that some variants need a separate profile/interface.)
- **Open-source `hypery11/flipper-tesla-fsd`:** ESP32/Flipper CAN nag-killer; documents
  X179/OBD pinouts, 500 kbit/s, and an experimental `0x3C2` scroll-press feature — the
  same signal we target.

---

## 9. Risks & open questions (per model)

- **DoIP/Ethernet ports (2024+ Juniper, some post-Apr-2024, 2025+ Standard):** these are
  **not CAN**. A CAN adapter will not talk to them. This is the **one true hardware
  variant**: a DoIP/Ethernet interface (or tapping Vehicle CAN at a different physical
  point that still exists on those cars). Flagged, not yet designed.
- **S/X refresh & Cybertruck message IDs:** the scroll `switchStatus` equivalent ID/layout
  is not yet captured; needs a short sniff per platform to fill the profile table.
- **Firmware-version drift:** Tesla occasionally renumbers/moves signals; the listen-first
  step detects a missing profile instead of transmitting blind.
- **Contention faults:** must validate on-car that phased injection produces zero
  persistent bus errors before calling any profile "flawless."

---

## 10. Roadmap

1. **Order** an SN65HVD230 CAN transceiver + a Model 3/Y diagnostic or X179 pigtail.
2. **Bench:** ESP32 TWAI + transceiver; loopback self-test at 500 kbit/s.
3. **Car, listen-only (Model 3/Y 2017–23):** confirm `0x3C2` at ~50 Hz on Vehicle CAN.
4. **Car, parked inject:** one `+1` scroll frame → volume moves one notch → run the 10 s
   up/down loop; validate zero persistent bus errors.
5. **Generalize, in order of effort:** Highland/Juniper (HW4 profile, X179 26-pin), S/X
   2021+ (Palladium profile, front-install cable), S/X legacy (`STW_ACTN_RQ` with counter +
   CRC). Fill the profile table from a short capture on each.
6. **Out of scope until an Ethernet-class variant exists:** Cybertruck (EtherLoop) and
   DoIP-only ports.

The single-car LIN relay (PHY-B + inline byte overwrite) stays in the repo as a reference
experiment for a 2017–2023 Model 3; it is not on the product path.

---

## 11. Sources

- Community DBC: <https://github.com/joshwardell/model3dbc/blob/master/Model3CAN.dbc>
- Open-source CAN nag-killer + pinouts: <https://github.com/hypery11/flipper-tesla-fsd>
- Tesla diagnostic port pinouts (Vehicle CAN 18/19): Tesla Owners Online "Diagnostic Port
  and Data Access" thread; TMC "OBD II Connector PinOUT List".
- X179 service reference: <https://service.tesla.com/docs/Model3/ElectricalReference/prog-233/connector/x179/>
- Enhauto S3XY Buttons/Commander: <https://www.enhauto.com/pages/buttons>
- Commercial nag modules (install location & behavior): tlyard / evooor / teslaunch / AFA-Motors listings.
- Model S CAN deciphering (wk057): <https://skie.net/uploads/TeslaCAN/>
