# VScale Offline

Offline Android app for the bodivis / VSCALE body-composition scale (Exingtech Y1 Bluetooth protocol).
No internet permission: profiles, measurements and calculations stay on the phone.

## Get the APK
Every push to `main` builds the app on GitHub. Open **Releases** (right-hand side of the repository page)
on your phone, download the newest `VScaleOffline-N.apk` and open it. Allow "Install unknown apps" for
your browser or file manager when Android asks. New builds install over the old one and keep your data.

## Use
1. Edit the profile (sex, date of birth, height).
2. Step on the scale barefoot and wait for the weight.
3. Tap **Connect**. The app sends your profile and the scale replies with the results for that weigh-in.
4. Already connected? Weigh again and tap **Get result**.

ErrF on the scale, or "weight only" in the app, means the scale got no skin contact. Stand barefoot on all four pads.

## Protocol
| Item | Value |
|---|---|
| Service | f433bd80-75b8-11e2-97d9-0002a5d5c51b |
| Results (notify) | 1a2ea400-75b9-11e2-be05-0002a5d5c51b |
| Commands (write) | 29f11080-75b9-11e2-8bf6-0002a5d5c51b |
| Profile command | `10 slot sex(0 male/1 female) age height_cm` |
| Result (20 bytes, big-endian) | slot, sex, age, height, weight/10, fat%/10, water%/10, bone/10, muscle/10, visceral, kcal, BMI/10, 0 |

The scale keeps its last weigh-in and recalculates it for whatever profile it receives.
Calories = weight × age/sex factor (men 24.0 <30, 22.3 30–49, 21.5 50+).

Features: profiles with goals, activity level and amputation correction; 26 measurement types plus custom types; selectable body fat, water and LBM formulas with every calculation shown; reference ranges; graph with smoothing, goal lines and projection; table with multi-select export and delete; statistics and comparison; insights; CSV and TXT export per measurement or in bulk; CSV import (incl. openScale); backups with optional automatic backup folder; reminders; assisted weighing; smart user assignment.
