import type { PartType } from './model/parts';
import type { Part, Wire } from './model/types';

export interface Example {
  id: string;
  title: string;
  summary: string;
  /** Step-by-step instructions shown after the example is loaded. */
  steps: string[];
  parts: Part[];
  wires: Wire[];
  source: string;
}

function builder() {
  const parts: Part[] = [];
  const wires: Wire[] = [];
  const add = (id: string, type: PartType, name: string, x: number, y: number, params?: Record<string, number>): string => {
    parts.push({ id, type, name, x, y, rot: 0, ...(params && { params }) });
    return id;
  };
  const wire = (a: string, pa: string, b: string, pb: string, color?: string) => {
    wires.push({ id: `w${wires.length + 1}`, from: { partId: a, pin: pa }, to: { partId: b, pin: pb }, ...(color && { color }) });
  };
  return { parts, wires, add, wire };
}

const RED = '#e5484d';
const BLACK = '#2b2f38';
const YELLOW = '#f5d90a';
const BLUE = '#3e8bff';

function blink(): Example {
  const b = builder();
  const esp = b.add('esp', 'esp32-devkit-v1', 'ESP1', 200, 200);
  const r = b.add('r1', 'resistor', 'R1', 360, 360, { ohms: 220 });
  const led = b.add('led1', 'led', 'LED1', 480, 360);
  b.wire(esp, 'D4', r, 'A', YELLOW);
  b.wire(r, 'B', led, 'A', RED);
  b.wire(led, 'K', esp, 'GND2', BLACK);
  return {
    id: 'blink',
    title: '1 · Blink an LED',
    summary: 'The classic first project: a GPIO pin drives an LED through a current-limiting resistor.',
    steps: [
      'Press Run in the code panel. The LED blinks and the wires show the current flowing.',
      'Select the LED and the resistor and read their current in the results table: about 5 mA.',
      'Change the resistor to 10 Ω. The LED current climbs and the simulator warns you.',
      'Change it back to 220 Ω. 220 Ω is a safe, beginner-friendly value for a 3.3 V pin.',
    ],
    parts: b.parts,
    wires: b.wires,
    source: `// Blink an LED on GPIO 4
const int LED_PIN = 4;

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  Serial.println("LED on");
  delay(500);
  digitalWrite(LED_PIN, LOW);
  Serial.println("LED off");
  delay(500);
}
`,
  };
}

function noResistor(): Example {
  const b = builder();
  const esp = b.add('esp', 'esp32-devkit-v1', 'ESP1', 200, 200);
  const led = b.add('led1', 'led', 'LED1', 380, 360);
  b.wire(esp, 'D4', led, 'A', YELLOW);
  b.wire(led, 'K', esp, 'GND2', BLACK);
  return {
    id: 'no-resistor',
    title: '2 · Mistake: LED without a resistor',
    summary: 'An LED wired straight to a GPIO pin. Run it and see how the simulator reports the overload.',
    steps: [
      'Press Run. The wires blink and the Issues list shows an overload.',
      'Read the "Suggested fix". It calculates a resistor value for you.',
      'Add a resistor between D4 and the LED with the suggested value.',
      'The warnings disappear when the current is safe.',
    ],
    parts: b.parts,
    wires: b.wires,
    source: `// This LED has no resistor. Find out why that is a problem.
void setup() {
  pinMode(4, OUTPUT);
}

void loop() {
  digitalWrite(4, HIGH);
  delay(1000);
}
`,
  };
}

function button(): Example {
  const b = builder();
  const esp = b.add('esp', 'esp32-devkit-v1', 'ESP1', 200, 200);
  const r = b.add('r1', 'resistor', 'R1', 360, 360, { ohms: 330 });
  const led = b.add('led1', 'led', 'LED1', 480, 360);
  const btn = b.add('btn1', 'button', 'BTN1', 260, 460);
  b.wire(esp, 'D4', r, 'A', YELLOW);
  b.wire(r, 'B', led, 'A', RED);
  b.wire(led, 'K', esp, 'GND2', BLACK);
  b.wire(esp, 'D5', btn, '1', BLUE);
  b.wire(btn, '2', esp, 'GND2', BLACK);
  return {
    id: 'button',
    title: '3 · Button controls an LED',
    summary: 'A push button on a pin with the internal pull-up enabled. Pressing it pulls the pin to ground.',
    steps: [
      'Press Run. The LED is off because the button is not pressed.',
      'Click and hold the red cap on BTN1. The LED turns on while you hold it.',
      'The pin reads HIGH (3.3 V) when released and LOW when pressed, which is why the code tests for LOW.',
    ],
    parts: b.parts,
    wires: b.wires,
    source: `// Pressed = LOW because of the internal pull-up
void setup() {
  pinMode(5, INPUT_PULLUP);
  pinMode(4, OUTPUT);
}

void loop() {
  if (digitalRead(5) == LOW) {
    digitalWrite(4, HIGH);
  } else {
    digitalWrite(4, LOW);
  }
  delay(20);
}
`,
  };
}

function motor(): Example {
  const b = builder();
  const esp = b.add('esp', 'esp32-devkit-v1', 'ESP1', 200, 200);
  const r = b.add('r1', 'resistor', 'R1', 560, 360, { ohms: 470 });
  const q = b.add('q1', 'npn', 'Q1', 480, 460);
  const bat = b.add('bat1', 'battery', 'BAT1', 200, 480, { voltage: 6, rint: 0.2 });
  const m = b.add('mot1', 'motor', 'MOT1', 340, 460, { ohms: 20 });
  const d = b.add('d1', 'diode', 'D1', 340, 560);
  b.wire(esp, 'D4', r, 'A', YELLOW);
  b.wire(r, 'B', q, 'B', BLUE);
  b.wire(bat, '+', m, 'M+', RED);
  b.wire(m, 'M-', q, 'C', RED);
  b.wire(q, 'E', bat, '-', BLACK);
  b.wire(bat, '-', esp, 'GND2', BLACK);
  b.wire(d, 'K', m, 'M+', RED);
  b.wire(d, 'A', m, 'M-', RED);
  return {
    id: 'motor',
    title: '4 · Drive a motor with a transistor',
    summary: 'A GPIO pin cannot power a motor directly. An NPN transistor switches the motor from a separate 6 V battery.',
    steps: [
      'Press Run. The motor draws about 300 mA from the battery while the pin supplies only a few mA.',
      'Notice that the battery minus and the ESP32 GND share a wire. All grounds must be common.',
      'Delete the diode D1. The simulator warns about the voltage spike when the motor switches off.',
      'Undo it by adding a diode across the motor with the stripe (cathode) toward the plus side.',
    ],
    parts: b.parts,
    wires: b.wires,
    source: `// Switch a motor on for 2 seconds, off for 2 seconds
void setup() {
  pinMode(4, OUTPUT);
}

void loop() {
  digitalWrite(4, HIGH);
  delay(2000);
  digitalWrite(4, LOW);
  delay(2000);
}
`,
  };
}

function pot(): Example {
  const b = builder();
  const esp = b.add('esp', 'esp32-devkit-v1', 'ESP1', 200, 200);
  const p = b.add('pot1', 'potentiometer', 'POT1', 360, 360, { ohms: 10000, position: 0.5 });
  b.wire(esp, '3V3', p, '1', RED);
  b.wire(p, '2', esp, 'GND2', BLACK);
  b.wire(p, 'W', esp, 'D34', YELLOW);
  return {
    id: 'potentiometer',
    title: '5 · Read a potentiometer',
    summary: 'A potentiometer works as an adjustable voltage divider read by the 12-bit ADC on GPIO 34.',
    steps: [
      'Press Run and watch the Serial output: about 2048 at the middle position.',
      'Select POT1 and change the wiper position. The reading follows.',
      'Check the divider current in the results table: it is tiny, so 10 kΩ is a safe choice.',
    ],
    parts: b.parts,
    wires: b.wires,
    source: `// Read an analog voltage (0 to 3.3 V gives 0 to 4095)
void setup() {
  Serial.begin(115200);
}

void loop() {
  int raw = analogRead(34);
  Serial.print("ADC: ");
  Serial.println(raw);
  delay(500);
}
`,
  };
}

function lcd(): Example {
  const b = builder();
  const esp = b.add('esp', 'esp32-devkit-v1', 'ESP1', 200, 200);
  const l = b.add('lcd1', 'lcd1602', 'LCD1', 300, 420, { address: 39, pullups: 0 });
  const pu1 = b.add('r1', 'resistor', 'R1', 500, 340, { ohms: 4700 });
  const pu2 = b.add('r2', 'resistor', 'R2', 500, 380, { ohms: 4700 });
  b.wire(esp, 'VIN', l, 'VCC', RED);
  b.wire(esp, 'GND', l, 'GND', BLACK);
  b.wire(esp, 'D21', l, 'SDA', YELLOW);
  b.wire(esp, 'D22', l, 'SCL', BLUE);
  b.wire(esp, '3V3', pu1, 'A', RED);
  b.wire(pu1, 'B', l, 'SDA', YELLOW);
  b.wire(esp, '3V3', pu2, 'A', RED);
  b.wire(pu2, 'B', l, 'SCL', BLUE);
  return {
    id: 'lcd',
    title: '6 · I2C LCD hello',
    summary: 'A 16x2 character LCD with an I2C backpack, using the LiquidCrystal_I2C library on SDA = GPIO 21 and SCL = GPIO 22.',
    steps: [
      'Press Run. The display shows two lines of text and a counter.',
      'Remove the SDA or SCL wire (or swap them) and run again: the console says the LCD is not found on the I2C bus.',
      'Change the address in the sketch to 0x3F: the display stays blank until the part’s address matches.',
      'The backpack is powered from 5 V (VIN). Its own pull-ups would push 5 V into the ESP32 pins, so here they are switched off in the part settings and 4.7 kΩ resistors pull the lines up to 3.3 V instead.',
    ],
    parts: b.parts,
    wires: b.wires,
    source: `#include <Wire.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);

int count = 0;

void setup() {
  Wire.begin(21, 22);
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("Hello, ESP32!");
}

void loop() {
  lcd.setCursor(0, 1);
  lcd.print("Count: ");
  lcd.print(count);
  lcd.print("   ");
  count++;
  delay(500);
}
`,
  };
}

function servoSweep(): Example {
  const b = builder();
  const esp = b.add('esp', 'esp32-devkit-v1', 'ESP1', 200, 200);
  const s = b.add('srv1', 'servo', 'SRV1', 400, 420);
  const c = b.add('c1', 'capacitor', 'C1', 560, 420);
  b.wire(esp, 'VIN', s, 'V+', RED);
  b.wire(esp, 'GND', s, 'GND', BLACK);
  b.wire(esp, 'D18', s, 'SIG', YELLOW);
  b.wire(esp, 'VIN', c, '+', RED);
  b.wire(c, '-', esp, 'GND', BLACK);
  return {
    id: 'servo',
    title: '7 · Sweep a servo',
    summary: 'A hobby servo takes 5 V power plus a signal wire; the Servo library turns an angle into the pulse it expects.',
    steps: [
      'Press Run. The horn sweeps from 0° to 180° and back.',
      'Unplug the SIG wire or V+ and run again: the console explains why the servo does not move.',
      'Select the servo and look at its current in the results table; the capacitor next to it absorbs the current surges a real servo causes.',
    ],
    parts: b.parts,
    wires: b.wires,
    source: `#include <ESP32Servo.h>

Servo myServo;

void setup() {
  Serial.begin(115200);
  myServo.attach(18);
}

void loop() {
  for (int angle = 0; angle <= 180; angle += 10) {
    myServo.write(angle);
    delay(100);
  }
  for (int angle = 180; angle >= 0; angle -= 10) {
    myServo.write(angle);
    delay(100);
  }
}
`,
  };
}

export const EXAMPLES: Example[] = [blink(), noResistor(), button(), motor(), pot(), lcd(), servoSweep()];
