# Assignment brief: Sensing — Force sensors and photocells

## Instructions from the course handout

1. Use a photocell, FSR, potentiometer, or a combination of these sensors.
2. Create an interesting computer visualization influenced by the sensor input.
3. Use p5.js (or another visualization language with a Firmata-like connection).
4. Run the p5 serial server so Arduino serial data can reach the sketch.
5. Embed the sensor in a physical object so the interaction feels intuitive.
6. Submit a website URL by the stated deadline.

The handout also describes the 10K-resistor voltage divider and reminds us to close Arduino's Serial Monitor while p5.js is connected.

## Project decisions

The project is **Impact Archive**. It keeps the FSR + potentiometer hardware from the first proposal but changes the interaction and visual language. The content now has a personal reason to exist: the texture archive is made from the artist's second-year photographs at Tongji University's College of Design and Innovation, while the optional camera records the present self.

- FSR: a tap or press is treated as a percussive impact. Every distinct hit saves a mirrored camera still converted to monochrome film grain when the camera is live (or cycles in one Tongji memory when it is off), adds more faces and asymmetry to the photographic crystal, and triggers a short, high-pitched browser click.
- Potentiometer: controls memory depth and glass tension. At one end the newest frame dominates; at the other, older press frames and campus photographs show through while the facet drift and rotation increase.
- Release: the impact settles while the accumulated structure remains and slowly erodes over time.
- Visual: a minimal black background, blue atmospheric memory photographs, asymmetric glass-like shard geometry, and sharp triangular cuts. The archive keeps the eight most recent press frames.

The camera is an optional local input. The raw `<video>` element is hidden, a frame is copied into an in-memory `p5.Graphics` object on impact, and no image is uploaded or written to disk by the sketch.

The face-based OpenProcessing sketch is a possible extension rather than the main direction. If a portrait replaces the current texture, the same crystal system can hold separate eye, nose, and mouth planes. This keeps the project centered on the physical FSR impact while leaving room for a later facial-stretch variation.

The OpenProcessing link is a visual reference only. It is not an additional course requirement and does not replace the handout requirements above.
