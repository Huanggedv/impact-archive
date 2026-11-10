// Impact Archive — Arduino sensor bridge
// Arduino Uno / Uno R4 Minima
// A0: FSR voltage divider (FSR to 5V, 10K resistor to GND)
// A1: potentiometer wiper (outer legs to 5V and GND)

const uint8_t PRESSURE_PIN = A0;
const uint8_t POT_PIN = A1;

const unsigned long SAMPLE_INTERVAL_MS = 20;
const float FILTER_ALPHA = 0.16f;

float pressureFiltered = 0.0f;
float potFiltered = 0.0f;
unsigned long lastSampleAt = 0;

void setup() {
  pinMode(PRESSURE_PIN, INPUT);
  pinMode(POT_PIN, INPUT);

  Serial.begin(9600);

  // Give the first values a sensible starting point before filtering begins.
  pressureFiltered = analogRead(PRESSURE_PIN);
  potFiltered = analogRead(POT_PIN);
}

void loop() {
  const unsigned long now = millis();
  if (now - lastSampleAt < SAMPLE_INTERVAL_MS) {
    return;
  }
  lastSampleAt = now;

  const int pressureRaw = analogRead(PRESSURE_PIN);
  const int potRaw = analogRead(POT_PIN);

  pressureFiltered += FILTER_ALPHA * (pressureRaw - pressureFiltered);
  potFiltered += FILTER_ALPHA * (potRaw - potFiltered);

  // Labeled values make the serial stream easy to debug and parse in p5.js.
  Serial.print("pressure:");
  Serial.print((int)pressureFiltered);
  Serial.print(",pot:");
  Serial.println((int)potFiltered);
}
