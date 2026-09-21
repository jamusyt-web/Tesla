# Injection plan — full LIN slave emulation

## Why the single-frame spoof failed
Sending only frame 0x26 makes VCLEFT see an *incomplete* switch module: every
other frame the module normally answers goes silent, so VCLEFT marks the wheel
switch faulty and ignores our scroll. Prior art (Ryan Huber's Model 3 wheel ->
Model S Plaid retrofit) shows the working approach is to emulate the WHOLE
module, not one frame.

## Approach: become the module
Our ESP32 answers every frame the real module answers (with valid data), so
VCLEFT sees a complete, healthy switch. Within that, we set frame 0x26 byte 1
= 0x40 (up) / 0xC0 (down) on a 10s schedule. One transceiver, no wire cut.

## Reverse-engineering steps
1. **Catalog which frames the module answers.**
   - Sniff with the module PLUGGED IN -> list A (all valid frames on the bus).
   - Sniff with the module UNPLUGGED -> list B (only the frames NOT from the
     module -- i.e. VCLEFT's own / other slaves).
   - The frames in A but not in B = the module's frames. We must emulate these.
2. **Capture the diagnostic sign-on if needed.**
   - Watch PIDs 0x3C (master request) and 0x3D (slave response) at power-up.
     If VCLEFT reads the module's NAD/identity, we must reproduce that response.
3. **Build the emulator.**
   - Answer every module frame with its last-known-good data.
   - Answer the 0x3C diagnostic request with the module's 0x3D response.
   - Modify 0x26 byte 1 on the 10s schedule.
   - Module unplugged; the ESP32 IS the module.

## Alternative: inline relay (fallback)
Keep the module, cut the LIN, sit in the middle with TWO transceivers, edit
byte 1 as the frame passes. Avoids the diagnostic RE but needs a 2nd
transceiver, a wire cut, and byte-synced forwarding firmware.

## Status
Known: bus read + decoded (0x26 byte1 = 0x40 up / 0xC0 down, enhanced cksum,
7 data bytes). Transmit onto bus works. Next: catalog the module's full frame
set (step 1).
