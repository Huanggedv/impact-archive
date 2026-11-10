# Wiring and physical construction

完整图示： [fsr-pot-wiring.svg](fsr-pot-wiring.svg)

## FSR voltage divider (A0)

```text
5V ── FSR ──┬── A0
             │
           10KΩ
             │
            GND
```

With this orientation, pressing the FSR should raise the A0 reading. If the value moves in the opposite direction, swap the FSR and resistor positions or invert the mapping in `sketch.js`.

## Potentiometer (A1)

```text
5V ── outer leg
GND ─ outer leg
A1 ── center wiper
```

Turn the potentiometer to confirm that the A1 value moves through most of the 0–1023 range.

## Suggested impact pad

```text
hand / fingertip
       ↓  tap or press
soft fabric, foam, or felt
       ↓
small rigid disk (coin-sized)
       ↓
FSR
       ↓
Arduino
```

The soft layer makes the FSR feel like a surface that can be struck. The disk spreads the force across the sensing area. Label the potentiometer **STILL / FRAGMENT**.

## Connection checklist

1. Upload `arduino/pressure_landscape.ino`.
2. Close Arduino's Serial Monitor.
3. Start the p5 serial server in a second terminal. If it is not installed yet:

   ```bash
   mkdir -p ~/p5-serialserver
   cd ~/p5-serialserver
   npm init -y
   npm install p5.serialserver
   node node_modules/p5.serialserver/startserver.js
   ```

   Keep that terminal open while using the website.
4. Open `p5js/index.html` through a local server.
5. Click the canvas once to unlock browser audio.
6. In Chrome or Edge, press **Connect** and choose the Arduino in the browser port picker. This direct Web Serial path does not need the p5 serial server. In Safari, start the p5 serial server first, wait for the port list, choose the Arduino port, and press **Connect**.
7. If the browser says **No port selected**, choose the USB Arduino and allow the connection. If no Arduino is connected, leave **DEMO: ON** or press **D**.
