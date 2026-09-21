# Captured LIN signal — Model 3 steering-wheel volume scroll

Captured live off the "SW" (steering wheel switch) connector's LIN wire,
2017–2023 Model 3, at **19200 baud**. LIN checksum on 0x26 validates
(see sniffer), so byte positions below are trustworthy.

## Target frame

**Frame ID `0x26`** (the steering-wheel switch status frame). Idle payload
looks like: `5E 00 10 08 5D <counter> <counter> <counter> 00` (byte 0 = 5E).

## Volume scroll = payload **byte 1**

| byte 1 | action                 | notes |
|--------|------------------------|-------|
| `0x00` | idle / no movement     | resting value |
| `0x40` | **volume UP one notch**   | byte 2 stays `0x10` |
| `0xC0` | **volume DOWN one notch** | byte 2 also goes `0x10 -> 0x0F` |

- It is a **per-click pulse**: byte 1 shows the value for one frame, then
  returns to `0x00`. Each pulse = one notch.
- byte 5/6/7 are a rolling counter — ignore for scroll.

## Injection implication

`0x26` is the **switch module's response** frame (a LIN slave answers the
VCLEFT master's poll). To inject we must control that response:
- **MITM relay** (flawless, real buttons keep working): sit inline, pass the
  module's frame through, overwrite byte 1 to `0x40`/`0xC0` on our schedule.
- **Spoof-slave** (simpler proof-of-concept, real buttons off): disconnect the
  module, answer `0x26` ourselves with byte 1 = pulse value on schedule.

Both need the transmit side (NPN driver) reconnected. TODO: capture one clean
full `0x26` frame + confirm checksum type (enhanced vs classic) before building
the responder.
