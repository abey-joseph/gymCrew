/* Gym Crew: everything about the people and the plan lives in this file.
 *
 * Editing tips
 * - Keep exercise `id`s stable. Logged sets are stored against them, so renaming an id
 *   orphans that exercise's history. Change `name`, `cue`, sets, reps etc. freely.
 * - After editing, bump CACHE_VERSION in sw.js (and APP_VERSION below) so phones
 *   download the new version.
 *
 * This file is loaded by the page AND by the service worker (importScripts), so it must
 * not touch `window` or `document`.
 */

const APP_VERSION = '1.3.0';

/* ---------- People ----------
 * There is no fixed start date: each person taps "Start my plan" in the app and
 * week 1 begins on the following Sunday (weeks run Sunday to Saturday) (saved in their own data).
 */

const USERS = {
  abey: {
    id: 'abey',
    name: 'Abey',
    goalType: 'cut',
    startWeight: 71.1,
    goalWeight: 60,
    goalText: '60 kg',
    targets: { calories: 1650, protein: 125, steps: 9000, sleep: 7 },
    startScan: {
      date: '2026-11-04', height: 162, weight: 71.1, bodyFat: 34.9, fatKg: 24.8,
      muscleKg: 43.7, visceral: 117, bmr: 1369, score: 61,
    },
    // Target weight at the end of each 4-week block (weeks 4, 8, 12, ...).
    milestones: { metric: 'weight', values: [69, 67, 65, 63, 61, 60] },
  },
  sudheep: {
    id: 'sudheep',
    name: 'Sudheep',
    goalType: 'cut',
    startWeight: 71.2,
    goalWeight: 60,
    goalText: '60 kg',
    targets: { calories: 1750, protein: 135, steps: 9000, sleep: 7 },
    startScan: {
      date: '2026-11-05', height: 165, weight: 71.2, bodyFat: 30.1, fatKg: 21.4,
      muscleKg: 47.1, visceral: 88, bmr: 1446, score: 67,
    },
    milestones: { metric: 'weight', values: [69, 67, 65, 63, 61, 60] },
    // Extra marker drawn on the weight chart.
    note: { weight: 64, label: 'likely no belly here' },
  },
  ashik: {
    id: 'ashik',
    name: 'Ashik',
    goalType: 'recomp',
    startWeight: 59.6,
    goalText: 'Stay 58–61 kg, body fat ≤ 20%, muscle ≥ 43 kg',
    weightBand: [58, 61],
    bodyFatTarget: 20,
    muscleTarget: 43,
    targets: { calories: 1950, protein: 110, steps: 8000, sleep: 7 },
    startScan: {
      date: '2026-11-04', height: 160, weight: 59.6, bodyFat: 27.2, fatKg: 16.2,
      muscleKg: 41.0, visceral: 70, bmr: 1307, score: 68,
    },
    // Target fat kg at the end of each 4-week block; muscle kg should rise or hold.
    milestones: { metric: 'fatKg', values: [15.4, 14.6, 13.8, 13.0, 12.2] },
  },
};

/* Weekly targets, the same for everyone: how many days (or sessions) per week. */
const WEEKLY_TARGETS = { gym: 4, steps: 5, protein: 6, calories: 5, sleep: 5 };

/* Plan weeks where every exercise drops to 2 sets (weights stay the same). */
const DELOAD_WEEKS = [6, 12, 18, 24];
const PLAN_WEEKS = 24;
const MILESTONE_EVERY_WEEKS = 4;

/* ---------- Equipment photos (also precached by sw.js) ---------- */

const IMAGE_DIR = './images/equipment/';
const IMAGES = {
  'chest-press.jpg': 'Hammer Strength chest press',
  'seated-row.jpg': 'Hammer Strength plate-loaded seated row',
  'lat-pulldown.jpg': 'Hammer Strength lat pulldown',
  'pec-fly-rear-delt.jpg': 'Hammer Strength pec fly / rear delt',
  'leg-extension.jpg': 'Hammer Strength leg extension',
  'cable-station.jpg': 'Life Fitness dual adjustable cable station',
  'assisted-pullup-dip.jpg': 'Life Fitness assisted pull-up / dip',
  'hack-squat.jpg': 'Pure Kraft hack / pendulum squat',
  'v-squat.jpg': 'Pure Kraft V-squat / belt squat',
  'smith-machine.jpg': 'Smith machine',
  'power-rack-bench-press.jpg': 'Power racks and barbell bench press',
  'adjustable-bench.jpg': 'Adjustable bench and dumbbells',
  'dumbbells-flat-bench.jpg': 'Dumbbells and flat bench',
  'dumbbell-rack.jpg': 'Dumbbell rack (2.5–60 kg)',
  'treadmill-stairmaster.jpg': 'Treadmills and StairMaster',
  'skierg.jpg': 'Concept2 SkiErg',
};

/* ---------- Session length ----------
 * core: 45, 60, 75 · full: 60, 75 · extra: 75 only.
 * At 75 min the first two exercises of each workout get +1 set.
 */
const SESSION_LENGTHS = [45, 60, 75];
const DEFAULT_SESSION_LENGTH = 60;
const TIERS_FOR_LENGTH = { 45: ['core'], 60: ['core', 'full'], 75: ['core', 'full', 'extra'] };

/* ---------- Workouts ----------
 * Exercise fields:
 *   id        stable id (logs are stored against it)
 *   lift      groups the same movement across workouts for personal records (defaults to id)
 *   name, image (filename in IMAGES or null), sets
 *   reps      [min, max]; with unit 'secs' these are seconds
 *   unit      'reps' (default) or 'secs'
 *   perSide   true when reps are "each arm / each leg"
 *   rest      seconds after each set
 *   tier      'core' | 'full' | 'extra'
 *   cue       short coaching cue (optional)
 *   superset  group label (optional); the rest timer only starts after the last exercise of the group
 *   inc       kg to add when the top of the rep range is hit (default 2.5)
 *   assisted  true when the kg is assistance (lower = stronger)
 */

const WARMUP = {
  minutes: 7,
  image: 'skierg.jpg',
  base: '4 min easy on the SkiErg or treadmill.',
  upper: '10 arm circles each way and 10 band pull-aparts.',
  lower: '10 bodyweight squats and 10 leg swings per leg.',
  sets: '50% × 10, then 75% × 5', // 2 light warm-up sets on the first exercise
};

const WORKOUT_ORDER = ['upperA', 'lowerA', 'upperB', 'lowerB'];

const WORKOUTS = {
  upperA: {
    id: 'upperA',
    name: 'Upper A',
    type: 'upper',
    exercises: [
      { id: 'chest-press', name: 'Chest press', image: 'chest-press.jpg', sets: 3, reps: [8, 10], rest: 120, tier: 'core',
        cue: 'Shoulder blades back, press without locking elbows.' },
      { id: 'seated-row', name: 'Seated row', image: 'seated-row.jpg', sets: 3, reps: [8, 10], rest: 120, tier: 'core',
        cue: 'Chest on pad, pull elbows back, squeeze 1 s.' },
      { id: 'db-shoulder-press', name: 'Seated dumbbell shoulder press', image: 'adjustable-bench.jpg', sets: 3, reps: [8, 12], rest: 90, tier: 'core',
        cue: "Bench upright, don't arch your lower back." },
      { id: 'lat-pulldown', name: 'Lat pulldown', image: 'lat-pulldown.jpg', sets: 3, reps: [10, 12], rest: 90, tier: 'core',
        cue: 'Pull to upper chest, elbows down and in.' },
      { id: 'cable-curl', name: 'Cable biceps curl', image: 'cable-station.jpg', sets: 2, reps: [12, 15], rest: 0, tier: 'full', superset: 'S1',
        cue: 'Elbows pinned to your sides.' },
      { id: 'rope-pushdown', name: 'Cable triceps pushdown (rope)', image: 'cable-station.jpg', sets: 2, reps: [12, 15], rest: 60, tier: 'full', superset: 'S1',
        cue: 'Spread the rope at the bottom.' },
      { id: 'pec-fly-a', lift: 'pec-fly', name: 'Pec fly', image: 'pec-fly-rear-delt.jpg', sets: 2, reps: [12, 15], rest: 60, tier: 'extra' },
    ],
    finisher: { name: 'StairMaster, steady pace', image: 'treadmill-stairmaster.jpg', unit: 'min', amounts: { 45: 5, 60: 10, 75: 15 } },
  },

  lowerA: {
    id: 'lowerA',
    name: 'Lower A',
    type: 'lower',
    exercises: [
      { id: 'hack-squat', name: 'Hack squat', image: 'hack-squat.jpg', sets: 3, reps: [8, 10], rest: 150, tier: 'core', inc: 5,
        cue: 'Full depth you can control, knees track over toes.' },
      { id: 'db-rdl', name: 'Dumbbell Romanian deadlift', image: 'dumbbell-rack.jpg', sets: 3, reps: [8, 10], rest: 120, tier: 'core', inc: 5,
        cue: 'Soft knees, hips back, flat back, feel the hamstrings.' },
      { id: 'leg-extension-a', lift: 'leg-extension', name: 'Leg extension', image: 'leg-extension.jpg', sets: 3, reps: [12, 15], rest: 60, tier: 'core',
        cue: 'Pause 1 s at the top.' },
      { id: 'walking-lunge', name: 'Walking lunges', image: 'dumbbell-rack.jpg', sets: 2, reps: [10, 10], perSide: true, rest: 90, tier: 'full' },
      { id: 'cable-crunch', name: 'Cable crunch (rope)', image: 'cable-station.jpg', sets: 3, reps: [12, 15], rest: 60, tier: 'full',
        cue: 'Curl your ribs toward your hips; hips stay still.' },
      { id: 'calf-raise-a', lift: 'calf-raise', name: 'Standing calf raise', image: 'smith-machine.jpg', sets: 3, reps: [12, 15], rest: 60, tier: 'extra' },
    ],
    finisher: { name: 'Treadmill brisk walk, 10–12% incline', image: 'treadmill-stairmaster.jpg', unit: 'min', amounts: { 45: 5, 60: 12, 75: 15 } },
  },

  upperB: {
    id: 'upperB',
    name: 'Upper B',
    type: 'upper',
    exercises: [
      { id: 'incline-db-press', name: 'Incline dumbbell press (~30°)', image: 'adjustable-bench.jpg', sets: 3, reps: [8, 10], rest: 120, tier: 'core' },
      { id: 'assisted-pullup', name: 'Assisted pull-up', image: 'assisted-pullup-dip.jpg', sets: 3, reps: [6, 10], rest: 120, tier: 'core', assisted: true,
        cue: 'Lower the assist weight over time. Log the assist kg (lower = stronger).' },
      { id: 'single-arm-cable-row', name: 'Single-arm cable row', image: 'cable-station.jpg', sets: 3, reps: [10, 12], perSide: true, rest: 90, tier: 'core' },
      { id: 'pec-fly-b', lift: 'pec-fly', name: 'Pec fly', image: 'pec-fly-rear-delt.jpg', sets: 2, reps: [12, 15], rest: 60, tier: 'core' },
      { id: 'cable-lateral-raise', name: 'Cable lateral raise (one arm, low pulley)', image: 'cable-station.jpg', sets: 2, reps: [12, 15], perSide: true, rest: 0, tier: 'full', superset: 'S1' },
      { id: 'rear-delt-fly', name: 'Rear delt fly (face the pad)', image: 'pec-fly-rear-delt.jpg', sets: 2, reps: [12, 15], rest: 60, tier: 'full', superset: 'S1' },
      { id: 'assisted-dip', name: 'Assisted dips', image: 'assisted-pullup-dip.jpg', sets: 2, reps: [8, 12], rest: 90, tier: 'extra', assisted: true },
    ],
    finisher: { name: 'SkiErg, 30 s hard / 30 s easy', image: 'skierg.jpg', unit: 'rounds', amounts: { 45: 4, 60: 8, 75: 10 } },
  },

  lowerB: {
    id: 'lowerB',
    name: 'Lower B',
    type: 'lower',
    exercises: [
      { id: 'smith-squat', name: 'Smith machine squat (feet slightly forward)', image: 'smith-machine.jpg', sets: 3, reps: [8, 10], rest: 150, tier: 'core', inc: 5 },
      { id: 'hip-thrust', name: 'Hip thrust (bench + barbell)', image: 'dumbbells-flat-bench.jpg', sets: 3, reps: [10, 12], rest: 120, tier: 'core', inc: 5,
        cue: 'Upper back on bench, chin tucked, squeeze glutes at the top.' },
      { id: 'cable-pull-through', name: 'Cable pull-through (rope, low pulley)', image: 'cable-station.jpg', sets: 3, reps: [12, 15], rest: 60, tier: 'core' },
      { id: 'calf-raise-b', lift: 'calf-raise', name: 'Standing calf raise (toes on a plate)', image: 'smith-machine.jpg', sets: 3, reps: [12, 15], rest: 60, tier: 'core' },
      { id: 'v-squat', name: 'V-squat', image: 'v-squat.jpg', sets: 2, reps: [12, 15], rest: 90, tier: 'full' },
      { id: 'plank', name: 'Plank', image: null, sets: 3, reps: [30, 45], unit: 'secs', rest: 45, tier: 'full' },
      { id: 'leg-extension-b', lift: 'leg-extension', name: 'Leg extension', image: 'leg-extension.jpg', sets: 2, reps: [15, 15], rest: 60, tier: 'extra' },
    ],
    finisher: { name: 'StairMaster', image: 'treadmill-stairmaster.jpg', unit: 'min', amounts: { 45: 5, 60: 10, 75: 15 } },
  },
};

/* ---------- "How to" animations ----------
 * One entry per movement, keyed by exercise `lift` (or `id`). The app draws a simple figure
 * and loops it from pose `a` (start) to pose `b` (end of the effort) and back.
 *
 * Canvas: 200 × 160, floor at y = 150. Angles are in degrees: 0 = up, 90 = right
 * (the way the figure faces), 180 = down, 270 = left. Each limb angle is absolute.
 *
 * view 'side'  : figure faces right.
 *   hx, hy  hip position   (or ax, ay = ankle position, keeps the foot planted)
 *   t torso · ua upper arm · fa forearm · th thigh · sh shin · ft foot
 *   th2, sh2, ft2 far leg (lunges, split stance)
 * view 'front' : figure faces you. ua/fa/th/sh are for the arm/leg on your right;
 *   the other side mirrors it unless ual/fal are given. ths shortens the thigh (seated).
 * view 'top'   : seen from above, forward is up. ua/fa as in 'front'.
 *
 * props: equipment. Fixed: rect [x,y,w,h], line [x1,y1,x2,y2] (+w width).
 *   Attached: db / grip at the hands, pad / plate at a joint (`at`), backpad along the torso,
 *   cable from point `from` to the hand, bar2 (front view bar between the hands, cable from `from`).
 * tempo: seconds [a→b, hold at b, b→a, hold at a]. words: what to think in each direction.
 */
const HOWTO = {
  'chest-press': {
    view: 'side', words: ['Press', 'Return'], tempo: [1, 0.3, 1.8, 0.4],
    props: [{ t: 'rect', p: [54, 118, 46, 7] }, { t: 'line', p: [77, 125, 77, 150], w: 5 }, { t: 'backpad' }, { t: 'grip' }],
    a: { hx: 80, hy: 116, t: -12, ua: 245, fa: 92, th: 92, sh: 178 },
    b: { ua: 95, fa: 90 },
    steps: ['Set the seat so the handles line up with mid-chest.', 'Shoulder blades back and down, then press forward until the arms are long, without locking the elbows.', 'Bring the handles back slowly, about 2 seconds.'],
  },
  'seated-row': {
    view: 'side', words: ['Pull', 'Reach'], tempo: [1, 1, 1.6, 0.3],
    props: [{ t: 'rect', p: [54, 118, 46, 7] }, { t: 'line', p: [77, 125, 77, 150], w: 5 }, { t: 'rect', p: [92, 80, 7, 28] }, { t: 'grip' }],
    a: { hx: 80, hy: 116, t: 5, ua: 95, fa: 95, th: 92, sh: 178 },
    b: { ua: 215, fa: 85 },
    steps: ['Chest on the pad, feet planted.', 'Pull your elbows back past your body and squeeze your shoulder blades for 1 second.', 'Let the arms go long again without leaving the pad.'],
  },
  'db-shoulder-press': {
    view: 'front', words: ['Press', 'Lower'], tempo: [1, 0.2, 1.6, 0.3],
    props: [{ t: 'rect', p: [84, 56, 32, 52] }, { t: 'rect', p: [78, 106, 44, 6] }, { t: 'db' }],
    a: { hx: 100, hy: 106, ua: 95, fa: 0, th: 170, sh: 180, ths: 0.35 },
    b: { ua: 15, fa: 5 },
    steps: ['Bench upright, back against the pad, dumbbells at shoulder height.', 'Press up until the arms are straight overhead, dumbbells close together.', "Lower back to the shoulders. Don't arch your lower back."],
  },
  'lat-pulldown': {
    view: 'front', words: ['Pull', 'Up'], tempo: [1, 0.3, 1.8, 0.3],
    props: [{ t: 'rect', p: [78, 106, 44, 6] }, { t: 'rect', p: [82, 99, 36, 6] }, { t: 'bar2', from: [100, 2] }],
    a: { hx: 100, hy: 106, ua: 25, fa: 15, th: 170, sh: 180, ths: 0.35 },
    b: { ua: 135, fa: -20 },
    steps: ['Thighs under the pad, wide grip on the bar.', 'Pull the bar to your upper chest, driving the elbows down and in.', 'Let it rise slowly until your arms are straight.'],
  },
  'cable-curl': {
    view: 'side', words: ['Curl', 'Lower'], tempo: [1, 0.3, 1.8, 0.2],
    props: [{ t: 'line', p: [152, 8, 152, 150], w: 6 }, { t: 'cable', from: [148, 144] }, { t: 'grip' }],
    a: { ax: 100, ay: 150, t: 0, th: 180, sh: 180, ua: 180, fa: 178 },
    b: { ua: 175, fa: 15 },
    steps: ['Stand facing the low pulley, bar or handle in both hands.', 'Elbows pinned to your sides: curl up until the forearms are vertical.', 'Lower all the way down slowly.'],
  },
  'rope-pushdown': {
    view: 'side', words: ['Push', 'Up'], tempo: [1, 0.5, 1.6, 0.2],
    props: [{ t: 'line', p: [152, 8, 152, 150], w: 6 }, { t: 'cable', from: [148, 14] }, { t: 'grip' }],
    a: { ax: 100, ay: 150, t: 8, th: 180, sh: 180, ua: 170, fa: 60 },
    b: { ua: 175, fa: 180 },
    steps: ['Rope on the high pulley, lean forward slightly, elbows at your sides.', 'Push down until the arms are straight and spread the rope at the bottom.', 'Let the hands come back up to chest height; elbows stay still.'],
  },
  'pec-fly': {
    view: 'top', words: ['Squeeze', 'Open'], tempo: [1, 0.6, 1.8, 0.3],
    props: [{ t: 'rect', p: [74, 102, 52, 9] }, { t: 'grip' }],
    a: { ua: 95, fa: 70 },
    b: { ua: 10, fa: -35 },
    steps: ['Seen from above. Sit tall with your back on the pad, arms out wide, slight bend in the elbows.', 'Bring the hands together in front of your chest, like hugging a tree.', 'Open slowly until you feel a stretch across the chest.'],
  },
  'hack-squat': {
    view: 'side', words: ['Down', 'Drive'], tempo: [1.8, 0.2, 1.2, 0.4], reverseWords: true,
    props: [{ t: 'line', p: [96, 145, 140, 137], w: 6 }, { t: 'backpad' }, { t: 'pad', at: 'shoulder', dx: 0, dy: -4 }],
    a: { ax: 112, ay: 140, ft: 80, t: -22, th: 175, sh: 185, ua: 150, fa: 10 },
    b: { t: -30, th: 100, sh: 215, ua: 142, fa: 2 },
    steps: ['Back flat on the pad, shoulders under the pads, feet shoulder-width on the platform.', 'Sit down as deep as you can control, knees tracking over your toes.', 'Drive back up through the whole foot without locking the knees.'],
  },
  'db-rdl': {
    view: 'side', words: ['Hinge', 'Stand'], tempo: [1.8, 0.3, 1.2, 0.3], reverseWords: true,
    props: [{ t: 'db' }],
    a: { ax: 100, ay: 150, t: 0, th: 178, sh: 182, ua: 180, fa: 180 },
    b: { t: 72, th: 150, sh: 190 },
    steps: ['Stand tall with a dumbbell in each hand, knees soft.', 'Push your hips back and let the dumbbells slide down your legs. Flat back, until you feel the hamstrings.', 'Squeeze your glutes to stand back up.'],
  },
  'leg-extension': {
    view: 'side', words: ['Kick', 'Lower'], tempo: [1, 1, 1.8, 0.3],
    props: [{ t: 'rect', p: [54, 114, 48, 7] }, { t: 'line', p: [77, 121, 77, 150], w: 5 }, { t: 'backpad' }, { t: 'pad', at: 'ankle', dx: 4, dy: 0, z: 'front' }],
    a: { hx: 80, hy: 112, t: -8, th: 90, sh: 180, ft: 100, ua: 175, fa: 120 },
    b: { sh: 95, ft: 10 },
    steps: ['Knees line up with the machine pivot, pad on your lower shins.', 'Straighten your legs and pause for 1 second at the top.', 'Lower slowly, but stop before the weight rests.'],
  },
  'walking-lunge': {
    view: 'side', words: ['Step & drop', 'Stand'], tempo: [1.4, 0.3, 1.2, 0.3],
    props: [{ t: 'db' }],
    a: { hx: 100, hy: 84, t: 0, th: 180, sh: 180, th2: 180, sh2: 180, ft2: 90, ua: 180, fa: 180 },
    b: { hx: 94, hy: 112, th: 97, sh: 182, th2: 200, sh2: 262, ft2: 120 },
    steps: ['Dumbbells at your sides, stand tall.', 'Take a long step and drop the back knee towards the floor; front shin stays roughly vertical.', 'Push through the front heel and bring the back foot through into the next step.'],
  },
  'cable-crunch': {
    view: 'side', words: ['Crunch', 'Up'], tempo: [1.2, 0.6, 1.6, 0.3],
    props: [{ t: 'line', p: [168, 6, 168, 150], w: 6 }, { t: 'cable', from: [162, 10] }, { t: 'grip' }],
    a: { hx: 86, hy: 114, t: 10, th: 178, sh: 270, ft: 270, ua: 150, fa: 330 },
    b: { t: 75, ua: 215, fa: 395 },
    steps: ['Kneel facing the high pulley, rope held beside your head.', 'Curl your ribs down towards your hips. Your hips stay still; only the spine bends.', 'Uncurl slowly back to upright.'],
  },
  'calf-raise': {
    view: 'side', words: ['Rise', 'Lower'], tempo: [0.8, 1, 1.6, 0.6],
    props: [{ t: 'line', p: [112, 6, 112, 150], w: 4 }, { t: 'rect', p: [96, 141, 22, 9] }, { t: 'plate', at: 'shoulder', r: 11, dx: -5, dy: 2 }],
    a: { ax: 100, ay: 140, ft: 95, t: 0, th: 180, sh: 180, ua: 160, fa: 350 },
    b: { ay: 132, ft: 135 },
    steps: ['Smith bar across your upper back, balls of your feet on the edge of a plate.', 'Rise as high as you can onto your toes and hold for a second.', 'Lower until the heels sink below the plate for a full stretch.'],
  },
  'incline-db-press': {
    view: 'side', words: ['Press', 'Lower'], tempo: [1, 0.2, 1.8, 0.3],
    props: [{ t: 'backpad' }, { t: 'rect', p: [62, 117, 40, 7] }, { t: 'line', p: [80, 124, 80, 150], w: 5 }, { t: 'db' }],
    a: { hx: 82, hy: 116, t: -58, th: 95, sh: 180, ua: 200, fa: 30 },
    b: { ua: 30, fa: 34 },
    steps: ['Bench at about 30°, dumbbells at the sides of your chest.', 'Press up and slightly back until the arms are straight over your upper chest.', 'Lower under control until you feel a stretch in the chest.'],
  },
  'assisted-pullup': {
    view: 'side', words: ['Pull up', 'Lower'], tempo: [1.2, 0.4, 2, 0.3],
    props: [{ t: 'line', p: [82, 22, 124, 22], w: 5 }, { t: 'line', p: [124, 6, 124, 150], w: 6 }, { t: 'pad', at: 'knee', dx: -2, dy: 4 }],
    a: { hx: 100, hy: 112, t: 0, th: 178, sh: 262, ft: 180, ua: 2, fa: 2 },
    b: { hy: 66, ua: 200, fa: 8 },
    steps: ['Knees on the pad, hands on the bar a bit wider than shoulders.', 'Pull your chest up to the bar, driving the elbows down.', 'Lower all the way until your arms are straight. Lower the assist kg over the weeks.'],
  },
  'single-arm-cable-row': {
    view: 'side', words: ['Row', 'Reach'], tempo: [1, 0.6, 1.6, 0.3],
    props: [{ t: 'line', p: [178, 8, 178, 150], w: 6 }, { t: 'cable', from: [174, 60] }, { t: 'grip' }],
    a: { hx: 96, hy: 84, t: 15, th: 168, sh: 182, th2: 195, sh2: 185, ua: 100, fa: 95 },
    b: { ua: 210, fa: 95 },
    steps: ['Pulley at chest height, staggered stance, one handle in one hand.', 'Row the elbow back past your ribs and squeeze.', 'Reach forward again, letting the shoulder blade move forward too.'],
  },
  'cable-lateral-raise': {
    view: 'front', words: ['Raise', 'Lower'], tempo: [1, 0.3, 1.8, 0.2],
    props: [{ t: 'line', p: [36, 8, 36, 150], w: 6 }, { t: 'cable', from: [40, 144] }, { t: 'grip', one: true }],
    a: { hx: 100, hy: 84, th: 180, sh: 180, ua: 172, fa: 176, ual: 180, fal: 180 },
    b: { ua: 92, fa: 96 },
    steps: ['Stand side-on to the low pulley and hold the handle in the far hand, across your body.', 'Raise the arm out to the side up to shoulder height, elbow slightly bent.', 'Lower slowly. Do every rep on one arm, then switch.'],
  },
  'rear-delt-fly': {
    view: 'top', words: ['Open', 'Return'], tempo: [1, 0.6, 1.6, 0.3],
    props: [{ t: 'rect', p: [76, 76, 48, 7] }, { t: 'grip' }],
    a: { ua: 5, fa: -15 },
    b: { ua: 100, fa: 95 },
    steps: ['Seen from above. Sit facing the pad, chest against it, arms straight out in front.', 'Sweep your arms out and back until they are in line with your shoulders.', 'Return slowly to the front.'],
  },
  'assisted-dip': {
    view: 'side', words: ['Dip', 'Press'], tempo: [1.8, 0.2, 1, 0.3], reverseWords: true,
    props: [{ t: 'line', p: [92, 101, 112, 101], w: 6 }, { t: 'line', p: [134, 6, 134, 150], w: 6 }, { t: 'pad', at: 'knee', dx: -2, dy: 4 }],
    a: { hx: 100, hy: 90, t: 0, th: 178, sh: 262, ft: 180, ua: 180, fa: 180 },
    b: { hy: 96, t: 14, ua: 215, fa: 160 },
    steps: ['Knees on the pad, arms straight on the dip handles.', 'Lean slightly forward and bend the elbows until the upper arms are about level.', 'Press back up to straight arms.'],
  },
  'smith-squat': {
    view: 'side', words: ['Down', 'Drive'], tempo: [1.8, 0.2, 1.2, 0.4], reverseWords: true,
    props: [{ t: 'line', p: [108, 6, 108, 150], w: 4 }, { t: 'plate', at: 'shoulder', r: 11, dx: -5, dy: 2 }],
    a: { ax: 112, ay: 150, t: 0, th: 180, sh: 180, ua: 160, fa: 350 },
    b: { t: 18, th: 98, sh: 205, ua: 165, fa: 355 },
    steps: ['Bar on your upper back, feet slightly in front of the bar.', 'Sit down and back until the thighs are about parallel.', 'Drive up through the whole foot.'],
  },
  'hip-thrust': {
    view: 'side', words: ['Drive', 'Lower'], tempo: [1, 1, 1.6, 0.3],
    props: [{ t: 'rect', p: [24, 118, 36, 32] }, { t: 'plate', at: 'hip', r: 15, dy: -8, z: 'front' }],
    a: { hx: 88, hy: 138, t: -70, th: 58, sh: 174, ua: 110, fa: 110 },
    b: { hx: 92, hy: 118, t: -90, th: 90, sh: 184, ua: 95, fa: 85 },
    steps: ['Upper back on the bench edge, bar over your hips (use a pad), feet flat.', 'Drive your hips up until your body is flat from shoulders to knees. Chin tucked, squeeze the glutes 1 second.', 'Lower the hips under control.'],
  },
  'cable-pull-through': {
    view: 'side', words: ['Stand tall', 'Hinge'], tempo: [1, 1, 1.6, 0.3],
    props: [{ t: 'line', p: [34, 8, 34, 150], w: 6 }, { t: 'cable', from: [40, 144] }, { t: 'grip' }],
    a: { ax: 110, ay: 150, t: 72, th: 152, sh: 188, ua: 212, fa: 222 },
    b: { t: -4, th: 180, sh: 180, ua: 168, fa: 172 },
    steps: ['Face away from the low pulley, rope between your legs, step forward.', 'Hinge: push the hips back, flat back, arms long between the legs.', 'Snap the hips forward to stand tall and squeeze the glutes.'],
  },
  'v-squat': {
    view: 'side', words: ['Down', 'Drive'], tempo: [1.8, 0.2, 1.2, 0.4], reverseWords: true,
    props: [{ t: 'rect', p: [96, 148, 44, 4] }, { t: 'pad', at: 'shoulder', dx: 0, dy: -5 }],
    a: { ax: 112, ay: 148, t: 4, th: 178, sh: 182, ua: 165, fa: 30 },
    b: { t: 22, th: 100, sh: 208, ua: 150, fa: 15 },
    steps: ['Shoulders under the pads, feet in the middle of the platform.', 'Sit down deep with control, knees over toes.', 'Drive back up, keeping your chest up.'],
  },
  'plank': {
    view: 'side', words: ['Hold', 'Hold'], tempo: [2, 0, 2, 0],
    props: [],
    a: { hx: 100, hy: 124, t: 80, th: 254, sh: 254, ft: 160, ua: 182, fa: 90 },
    b: { hy: 123 },
    steps: ['Forearms on the floor, elbows under your shoulders.', 'Body in one straight line: squeeze glutes and brace your stomach.', "Breathe normally and hold. Don't let the hips sag or pike up."],
  },
};
