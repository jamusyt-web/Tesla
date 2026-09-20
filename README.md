# Tesla Model 3 Steering-Wheel LIN Volume Chip

A bench/proof-of-concept device that makes a Model 3 (2017–2023) raise the audio
volume one notch, then lower it one notch, on a 10-second cadence — by injecting
onto the steering-wheel **LIN bus** so the car's own body controller does the rest.

> ⚠️ **Scope & safety.** This is for authorized testing on a vehicle you own.
> You will be working next to a **live airbag**. Read
> [`docs/wiring-and-tap.md`](docs/wiring-and-tap.md) fully before touching the car.
> The discrete transceiver here is for **bench proving and a working demo**; a
> permanent in-car unit should use a real LIN transceiver IC (TJA1021/MCP2004).

---

## How it works (the signal path)

```
 scroll wheel ──LIN──► VCLEFT ──CAN 0x3C2──► MCU/infotainment ──► volume
 (LIN slave)         (body controller,      (reads swcLeftScrollTicks
                      LIN→CAN translator)     and changes volume)
```

- The scroll wheels/buttons are **LIN slaves**; they do **not** talk CAN directly.
- **VCLEFT** (left body controller) reads them over LIN and re-broadcasts the state
  on the **Vehicle CAN bus** as message **`0x3C2` (dec 962)** at ~50 Hz.
- The infotainment computer reads `0x3C2` and adjusts the volume.

Because VCLEFT does the LIN→CAN translation, injecting on **LIN** is clean: we let
VCLEFT build the CAN frame, so there is **no duplicate-CAN-ID conflict** and no
gateway fault codes. (Injecting `0x3C2` on CAN directly would collide with VCLEFT,
which is already transmitting that ID — fragile, avoided here.)

### The target signal (community `Model3CAN.dbc`)

`0x3C2` is multiplexed; scroll data is present only when
`VCLEFT_switchStatusIndex == 1`:

| Signal | Bits | Type | Meaning |
|--------|------|------|---------|
| `VCLEFT_switchStatusIndex` | 0\|2 | mux selector | must be `1` for scroll |
| `VCLEFT_swcLeftScrollTicks` | 16\|6 | **signed** (2's-comp), LE | **left scroll = volume** |
| `VCLEFT_swcRightScrollTicks` | 24\|6 | signed, LE | right scroll |

`swcLeftScrollTicks` is a **delta** (ticks since the last frame), so:
- `+1` = volume **up** one notch
- `-1` = volume **down** one notch
- `0`  = no movement

> The `.dbc` is community-reverse-engineered and can differ by firmware/year.
> **Verify the layout against a live capture** (sniffer mode) before trusting it.

---

## Hardware

See the parts list in [`docs/wiring-and-tap.md`](docs/wiring-and-tap.md). Summary:

- **ESP32 WROOM-32 dev board** (use this for the 2-UART relay; the ESP32-C3 minis
  have only one free UART — fine for a single-side build).
- **Discrete LIN physical layer** built from kit parts:
  - **NPN transistor (2N2222 / 2N3904)** as the open-collector bus driver — *not*
    the 2N7000, whose gate threshold is marginal at 3.3 V. See the wiring doc.
  - **Resistor divider** (e.g. 10 kΩ + 3.3 kΩ ≈ 3.0 V) for receive level-shift.
- **12 V→5 V buck** to power the ESP32 from the car's 12 V.
- Final in-car build: swap the discretes for a **TJA1021/MCP2004** transceiver IC.

---

## Build & flash order

1. **Sniff first** (`MODE_SNIFF`). Capture VCLEFT's LIN traffic, find the baud rate,
   the scroll-frame **PID**, the byte offset of the tick value, and the **checksum
   type** (classic vs enhanced). Fill those into `config.h`.
2. **Bench-inject** (`MODE_SLAVE_INJECT`) on a desk rig with a 12 V supply and a
   1 kΩ pull-up, to confirm the response framing and the 10 s state machine.
3. **In-car** — tap the LIN wire per the wiring doc and confirm the volume moves.

Firmware lives in [`firmware/tesla_lin_volume/`](firmware/tesla_lin_volume/).

---

## Status

Prototype scaffolding. The inject path has **TODOs** that must be filled from your
own capture — it is deliberately not hardcoded to unverified `.dbc` values.
