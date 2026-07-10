// Light fitness/nutrition lines shown on AI loading screens. Keep them short,
// warm, and a little daft — they're meant to make a few seconds of waiting feel
// friendly. Mix of puns, gym-life confessions, and small wins.

export const FITNESS_JOKES: string[] = [
  "🏋️ Why did the gym close down? It just didn't work out.",
  "🍳 Meal prep is really just future-you being grateful for past-you.",
  "💪 My trainer promised me a six-pack in two weeks. The fridge had other plans.",
  "🏃 I run like the wind. If the wind stopped every 200m for snacks.",
  "🧘 I tried yoga. Turns out I'm not flexible with my schedule either.",
  "🥗 A salad walked into the gym. The trainer said, finally, something light.",
  "🍗 Protein is basically chicken quietly saying, I believe in you.",
  "😅 My favourite move is halfway between a lunge and a crunch. I call it lunch.",
  "🏃 The treadmill and I have history. It loves to watch me hate it.",
  "🍕 Abs are great. But have you met garlic bread?",
  "🏋️ The barbell left the kettlebell. It just needed a bit of space to grow.",
  "🤸 New workout unlocked: pulling myself up off the sofa. Three sets.",
  "🏃 Cardio is my heart packing a bag to go find a calmer body.",
  "💪 No pain, no gain, they said. My couch runs on no pain, all comfort.",
  "🏋️ My spotter is so kind he claps when I rack an empty bar.",
  "🧗 I'm elite at rock climbing. On the app. From bed.",
  "🥦 Eat your greens, they said. So I had green M&Ms. Baby steps.",
  "🏃 I entered a marathon. My phone just calls it a very busy day.",
  "💪 Biceps are just arms that decided to make it everyone's problem.",
  "🏋️ Squats now so you can pick things up later. Usually snacks.",
  "🥤 Pre-workout has kicked in and I'm now humming at a slightly illegal frequency.",
  "🏃 Rest days are leg days for the couch. It's getting stronger, honestly.",
  "🍌 A banana is just an energy bar that came in its own packaging.",
  "💪 I flexed at the mirror and it flexed back. We're friends now.",
  "🍗 Me and my macros are in a committed relationship. Mostly.",
  "🏃 I'm on a seafood diet. I see food, and now I log it. Growth.",
  "🧠 The hardest muscle to train is the one that decides to start. You just used it.",
  "🥚 Some days you're the egg. Some days you're the whisk. Log it anyway.",
  "🏋️ I only lift on days ending in 'y'. Been heavy ever since.",
  "🥑 Avocados: proof nature wanted us to eat well and also gamble on ripeness.",
  "🍠 Sweet potatoes never skip leg day. It's all in the roots.",
  "💧 I drank so much water before this set I could hear it sloshing at rep three.",
  "🥛 Milk was the original pre-workout. Ask literally any calf.",
  "🍎 An apple a day keeps the trainer away, if your aim is good.",
  "🧘 Breathe in confidence, breathe out doubt, and a bit of last night's dinner.",
  "🏋️ I re-racked my own weights today. My gym card should upgrade to platinum.",
  "🍳 Egg whites build muscle. The yolk builds character. I eat both.",
  "🏃 My watch congratulated me for standing up. Low bar, but I'll take the win.",
  "💪 Progress is quiet. It rarely texts back. But it shows up.",
  "🥗 The scale and I disagree, so I've stopped inviting it to things.",
  "🏋️ Warming up counts as a workout if you're honest about your baseline.",
  "🍜 Carbs get a bad rap. Carbs also get me up the stairs. We're good.",
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
