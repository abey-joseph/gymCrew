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

const APP_VERSION = '1.1.0';

/* ---------- People ----------
 * There is no fixed start date: each person taps "Start my plan" in the app and
 * week 1 begins on the following Monday (saved in their own data).
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
