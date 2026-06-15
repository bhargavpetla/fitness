// Light fitness/nutrition jokes shown on AI loading screens. Keep them short,
// warm, and groan-worthy — they're meant to make a 3-second wait feel friendly.

export const FITNESS_JOKES: string[] = [
  "🏋️ Why don't dumbbells ever get invited to parties? They're too heavy to lift the mood.",
  "🥦 I told my broccoli a joke. It didn't laugh — it's a little stalk-er.",
  "🍳 Why did the egg go to the gym? To get egg-cellent gains.",
  "💪 My personal trainer said I could get a six-pack in two weeks. The fridge agreed.",
  "🏃 I run like the wind… if the wind had to stop for snacks.",
  "🥚 How do eggs stay fit? They eggs-ercise every morning.",
  "🍌 Why did the banana go to the doctor? It wasn't peeling well after leg day.",
  "🧘 I tried yoga once. Turns out I'm not very flexible with my schedule.",
  "🏋️ I lift weights only on days that end in 'y'. So far, so heavy.",
  "🥗 A salad walks into a gym. The trainer says: finally, something light.",
  "🍗 Protein is just chicken's way of saying 'I believe in you.'",
  "😅 My favorite exercise is a cross between a lunge and a crunch. I call it lunch.",
  "🏃 The treadmill and I have a love-hate relationship. It loves to watch me hate it.",
  "💧 I drink so much water before workouts I basically swim through my reps.",
  "🍕 Abs are great, but have you tried pizza? — your willpower, probably.",
  "🏋️ Why did the barbell break up with the kettlebell? It needed space to grow.",
  "🥑 Avocados are proof that nature wanted us to eat well and also do math on ripeness.",
  "🤸 I do a workout called 'sofa pull-ups' — I pull myself up off the sofa.",
  "🍠 Sweet potatoes don't skip leg day. They're all about those roots.",
  "🏃 Cardio is just my heart trying to leave my body to find a calmer host.",
  "💪 They say no pain, no gain. My couch says no pain, all comfort.",
  "🥛 Milk is the original pre-workout. Ask any calf.",
  "🏋️ My spotter is so supportive he claps even when I rack the empty bar.",
  "🍎 An apple a day keeps the trainer away — if you throw it fast enough.",
  "🧗 I'm great at rock climbing… on the bouldering app, from my bed.",
  "🥦 Eat your greens, they said. So I ate green M&Ms. Progress.",
  "🏃 I signed up for a marathon. My phone calls it 'a lot of steps.'",
  "💪 Biceps are just arms that decided to show off.",
  "🍳 Meal prep is just future-me being grateful for past-me.",
  "🏋️ Squats: because someday you'll have to pick something up. Probably a snack.",
  "🥤 My pre-workout kicked in. Now I'm vibrating at the frequency of greatness.",
  "🧘 Inhale confidence, exhale doubt — and maybe a little of last night's burrito.",
  "🏃 Rest days are training days for the couch. It's getting stronger too.",
  "🍌 Bananas: nature's energy bar with built-in packaging. Chef's kiss.",
  "💪 I flexed in the mirror and the mirror flexed back. We're a team now.",
  "🥗 Calories don't count if you eat standing up — said no scale ever.",
  "🏋️ Why did the gym close down? It just didn't work out.",
  "🍗 My macros and I are in a committed relationship. Mostly committed.",
  "🏃 I'm on a seafood diet. I see food and I track it now. Growth.",
  "💧 Hydrate or diedrate — the only spelling I'll defend at the gym.",
  "🧠 The hardest muscle to train is the one that decides to start. You just flexed it.",
  "🥚 Crack open a good day — it's egg-stremely within reach.",
];

// Returns a randomly ordered copy so each loading session feels fresh.
export function shuffledJokes(): string[] {
  const a = [...FITNESS_JOKES];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
