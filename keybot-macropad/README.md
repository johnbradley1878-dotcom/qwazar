# KeyBot Pad 🐶🎮

A colourful Bluetooth macro pad for the Keyestudio KeyBot tamagotchi (`keybotQZR_tamagotchi.ino`).
It runs in **Chrome on Android**. It talks to the HC-06 over Bluetooth Classic using the Web Serial API, so you don't need to install an app from the store.

## 1. Put it online (one-time, free)
Web Serial only works on a secure (https) web address. Pick one of these:

* **Netlify Drop (easiest):** go to https://app.netlify.com/drop on your PC and drag this whole
  `keybot-macropad` folder onto the page. You get a link like `https://something.netlify.app`.
* **GitHub Pages:** upload the files to a repo, then go to Settings → Pages → Deploy from branch.

## 2. On your phone
1. Switch the robot on. In **Android Settings → Bluetooth**, pair with **HC-06** (PIN is usually `1234`).
2. Open your link in **Chrome**, tap ⋮ → **Add to Home screen** (or **Install app**).
3. Open KeyBot Pad from the home screen and tap **Connect**. Pick the HC-06.
   The app remembers it after that.

## Buttons
| Button | Sends | | Button | Sends |
|---|---|---|---|---|
| Feed (surprise) | `F` | | Cuddle | `P` |
| Bone / Fish / Burger / Potato | `1` `2` `3` `4` | | Fetch | `G` |
| Drink | `D` | | Scare | `S` |
| Wash | `W` | | Sleep / Wake | `Z` / `A` |
| Change nappy | `9` | | Stats (fills the meters) | `?` |
| Sound on/off | `M` | | Turn test / Help | `C` / `H` |
| D-pad | `I` `K` `J` `L` (repeats while held) | | STOP | `X` |

## Adding a new function later
1. In the sketch, add a new `case` to `handleCommand()`, e.g. `case 'R': doDance(); break;`.
   Use a letter that isn't taken yet: B, E, N, O, Q, R, T, U, V, Y, or 0, 5, 6, 7, 8.
2. In the app, tap a dashed **Free slot**. Give it a label, emoji, colour and the command `R`, then tap **Save**.
3. If you run out of slots, go to **Settings → Add free slot**. Tap **✏️ Edit** to change or move any button.

Your layout is saved on the phone. Use **Settings → Export layout** to back it up.
